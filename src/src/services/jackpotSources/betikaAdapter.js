const axios = require("axios");

const PLATFORM = "BETIKA";
const EVENTS_URL = "https://api.betika.com/v1/jackpot/events";
// Configurable so this doesn't need a code change if 15s turns out too
// tight from wherever this is actually deployed (Betika's API can be
// noticeably slower to first-byte than a browser's warm connection).
const REQUEST_TIMEOUT_MS = Number(process.env.BETIKA_JACKPOT_TIMEOUT_MS) || 20000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  // Betika's API sits behind the same anti-bot layer as most Kenyan
  // bookmaker sites — a request with no Origin/Referer (i.e. not coming
  // "from" betika.com) is a common reason for it to silently stall or
  // hang until timeout rather than reject outright.
  Origin: "https://www.betika.com",
  Referer: "https://www.betika.com/jackpot",
};

/**
 * CONFIRMED (captured via browser DevTools, 2026-07-29):
 *   GET https://api.betika.com/v1/jackpot/events
 * Returns an array of jackpot pool metadata — one entry per
 * active/upcoming jackpot round, e.g.:
 *   {
 *     id: "2528",
 *     event_name: "15M MIDWEEK JACKPOT",
 *     status: "ACTIVE",
 *     event_expiry: "2026-08-01 18:30:59",
 *     total_games: "15",
 *     prize: "15000000.00",
 *     product_id: "6",
 *     max_combinations: "32",
 *     max_combinations_with_token: 8,
 *     max_combinations_without_token: "32",
 *     event_week_number: null,
 *     enable_game_pass_feature: null,
 *   }
 * No games/teams here — just the pool itself. The actual per-leg game
 * list lives behind a separate (not yet confirmed) endpoint; see
 * fetchGames() below.
 */
async function fetchPoolMeta() {
  const { data } = await axios.get(EVENTS_URL, { timeout: REQUEST_TIMEOUT_MS, headers: HEADERS });
  const list = data?.data ?? data?.events ?? (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

/**
 * Maps a Betika event_name (e.g. "15M MIDWEEK JACKPOT", "SABABISHA
 * JACKPOT", "MEGA GRAND JACKPOT") to our JackpotType enum. Keyword-based
 * since Betika's events list has no explicit "type" field — falls back
 * to game count when the name doesn't match a known keyword.
 */
function inferJackpotType(eventName, totalGames) {
  const name = (eventName || "").toUpperCase();
  if (name.includes("SABABISHA")) return "SABABISHA";
  if (name.includes("MIDWEEK")) return "MIDWEEK";
  if (name.includes("GRAND") || name.includes("MEGA")) return "GRAND";
  // Fallback purely on game count if the name doesn't say — see
  // config/jackpotPlatforms.js for Betika's published game counts.
  return totalGames >= 16 ? "GRAND" : "MIDWEEK";
}

/**
 * NOT YET CONFIRMED. Betika's events-list response above only carries
 * pool metadata (id, name, prize, expiry, total_games) — no team names —
 * so the per-leg game list needs a second request. The endpoint shape
 * hasn't been captured yet; this tries the most plausible URL pattern
 * (event id appended to the same jackpot API) and several plausible
 * response shapes, and logs the real top-level keys if none match, so
 * wiring in the correct field names later is a one-line fix rather than
 * a re-diagnosis — same approach as sportpesaAdapter.js.
 *
 * To finish this properly: open the Betika jackpot page for a specific
 * round, open DevTools → Network → XHR, find the request that returns
 * the 15 (or however many) fixtures with team names, and update the
 * accessors below to match its real shape (or point
 * BETIKA_JACKPOT_ENDPOINT at it, with `{eventId}` as a placeholder).
 */
async function fetchGames(eventId) {
  const endpointOverride = process.env.BETIKA_JACKPOT_ENDPOINT;
  const url = endpointOverride ? endpointOverride.replace("{eventId}", eventId) : `${EVENTS_URL}/${eventId}`;

  try {
    const { data } = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS, headers: HEADERS });
    const list =
      data?.data?.games || data?.data?.matches || data?.games || data?.matches || data?.data || (Array.isArray(data) ? data : null);

    if (!list) {
      console.warn(
        `[jackpotSources:${PLATFORM}] games response shape not recognized for event ${eventId} — top-level keys: [${Object.keys(data || {}).join(", ")}]. Update fetchGames() in betikaAdapter.js to match, or set BETIKA_JACKPOT_ENDPOINT.`
      );
      return [];
    }

    return list
      .map((g, i) => ({
        position: g.position ?? g.game_no ?? g.gameNumber ?? i + 1,
        homeTeam: g.home_team || g.homeTeam || g.team_h || g.home?.name,
        awayTeam: g.away_team || g.awayTeam || g.team_a || g.away?.name,
      }))
      .filter((g) => g.homeTeam && g.awayTeam);
  } catch (err) {
    console.error(`[jackpotSources:${PLATFORM}] games fetch failed for event ${eventId}:`, err.message);
    return [];
  }
}

async function fetchCurrentJackpots() {
  if (process.env.BETIKA_JACKPOT_ENABLED !== "true") {
    console.log(`[jackpotSources:${PLATFORM}] BETIKA_JACKPOT_ENABLED not set to "true" — skipping`);
    return [];
  }

  try {
    const pools = await fetchPoolMeta();
    const active = pools.filter((p) => (p.status || "").toUpperCase() === "ACTIVE");
    const results = [];

    for (const pool of active) {
      const totalGames = Number(pool.total_games) || 0;
      const games = await fetchGames(pool.id);

      if (games.length === 0) {
        console.log(
          `[jackpotSources:${PLATFORM}] "${pool.event_name}" (#${pool.id}, KES ${Number(pool.prize || 0).toLocaleString()}, ${totalGames} games) found but its game list couldn't be fetched yet — see fetchGames() TODO`
        );
        continue;
      }

      results.push({
        platform: PLATFORM,
        type: inferJackpotType(pool.event_name, totalGames),
        label: pool.event_name || `Betika Jackpot #${pool.id}`,
        games,
      });
    }

    return results;
  } catch (err) {
    console.error(`[jackpotSources:${PLATFORM}] fetch failed:`, err.message);
    return [];
  }
}

module.exports = { platform: PLATFORM, fetchCurrentJackpots, fetchPoolMeta, fetchGames, inferJackpotType };
