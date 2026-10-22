const axios = require("axios");

const PLATFORM = "SPORTPESA";
const BASE_URL = "https://www.ke.sportpesa.com/api";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

/**
 * CONFIRMED (captured via Chrome DevTools, 2026-07-27):
 *   GET https://www.ke.sportpesa.com/api/jackpots/
 * Returns pool metadata for BOTH the regular Jackpot and MEGA Jackpot Pro
 * in one call — no games/teams, just ids/amounts/active flags:
 *   {
 *     is_active, maxDoublePredict, maxTriplePredict, amount, betAmount, id,
 *     is_mega_active, mega_maxDoublePredict, mega_maxTriplePredict,
 *     mega_amount, mega_betAmount, mega_id, promo_enabled, promo_start,
 *     promo_end, first_game_start_utc, mega_first_game_start_utc
 *   }
 * `id` / `mega_id` are the pool ids needed to fetch each pool's actual
 * game list (see fetchGames below).
 */
async function fetchPoolMeta() {
  const { data } = await axios.get(`${BASE_URL}/jackpots/`, { timeout: 15000, headers: HEADERS });
  return data;
}

/**
 * NOT YET CONFIRMED. The request name "events?type=regular" is visible
 * in SportPesa's own Network tab (screenshot, 2026-07-27) and is almost
 * certainly the games-list endpoint, but its actual response shape
 * hasn't been captured yet — the field names below are a best-effort
 * guess. This tries several plausible shapes; if none match, it logs
 * the real top-level keys instead of failing silently, so wiring in the
 * correct field names later is a one-line fix, not a re-diagnosis.
 *
 * To finish this properly: open the jackpot page, click that request in
 * DevTools, copy its Response tab content, and update the field
 * accessors below to match.
 */
async function fetchGames(jackpotId, type) {
  try {
    const { data } = await axios.get(`${BASE_URL}/events`, {
      params: { type, jackpotId },
      timeout: 15000,
      headers: HEADERS,
    });

    const list = data.events || data.games || data.matches || data.data || (Array.isArray(data) ? data : null);
    if (!list) {
      console.warn(
        `[jackpotSources:SPORTPESA] events response shape not recognized for type=${type} — top-level keys: [${Object.keys(data).join(", ")}]. Update fetchGames() in sportpesaAdapter.js to match.`
      );
      return [];
    }

    return list
      .map((g, i) => ({
        position: g.position ?? g.gameNumber ?? g.order ?? i + 1,
        homeTeam: g.homeTeam || g.home_team || g.home?.name || g.teamHome || g.home_team_name,
        awayTeam: g.awayTeam || g.away_team || g.away?.name || g.teamAway || g.away_team_name,
      }))
      .filter((g) => g.homeTeam && g.awayTeam);
  } catch (err) {
    console.error(`[jackpotSources:SPORTPESA] events fetch failed for type=${type}:`, err.message);
    return [];
  }
}

async function fetchCurrentJackpots() {
  if (process.env.SPORTPESA_JACKPOT_ENABLED !== "true") {
    console.log(`[jackpotSources:${PLATFORM}] SPORTPESA_JACKPOT_ENABLED not set to "true" — skipping`);
    return [];
  }

  try {
    const meta = await fetchPoolMeta();
    const pools = [];

    if (meta.id) {
      const games = await fetchGames(meta.id, "regular");
      if (games.length > 0) {
        pools.push({
          platform: PLATFORM,
          type: games.length >= 16 ? "MEGA" : "MIDWEEK",
          label: `SportPesa Jackpot #${meta.id} — KSH ${(meta.amount || 0).toLocaleString()}`,
          games,
        });
      } else {
        console.log(`[jackpotSources:${PLATFORM}] pool #${meta.id} found (KSH ${(meta.amount || 0).toLocaleString()}) but its game list couldn't be fetched yet — see fetchGames() TODO`);
      }
    }

    if (meta.mega_id) {
      const games = await fetchGames(meta.mega_id, "mega");
      if (games.length > 0) {
        pools.push({
          platform: PLATFORM,
          type: "MEGA",
          label: `SportPesa Mega Jackpot Pro #${meta.mega_id} — KSH ${(meta.mega_amount || 0).toLocaleString()}`,
          games,
        });
      } else {
        console.log(`[jackpotSources:${PLATFORM}] MEGA pool #${meta.mega_id} found (KSH ${(meta.mega_amount || 0).toLocaleString()}) but its game list couldn't be fetched yet — see fetchGames() TODO`);
      }
    }

    return pools;
  } catch (err) {
    console.error(`[jackpotSources:${PLATFORM}] fetch failed:`, err.message);
    return [];
  }
}

module.exports = { platform: PLATFORM, fetchCurrentJackpots, fetchPoolMeta, fetchGames };
