const axios = require("axios");

const PLATFORM = "SHABIKI";

/**
 * STATUS: not yet wired up. See ./index.js for how to capture the real
 * endpoint via DevTools, then set SHABIKI_JACKPOT_ENDPOINT in .env and
 * adjust the mapping below to match the actual response shape.
 */
async function fetchCurrentJackpots() {
  const endpoint = process.env.SHABIKI_JACKPOT_ENDPOINT;
  if (!endpoint) {
    console.log(`[jackpotSources:${PLATFORM}] SHABIKI_JACKPOT_ENDPOINT not set — skipping (adapter not wired up yet)`);
    return [];
  }

  try {
    const { data } = await axios.get(endpoint, { timeout: 15000 });

    // PLACEHOLDER MAPPING — replace with the real response shape.
    const pools = data.jackpots || data.data || [];
    return pools.map((pool) => ({
      platform: PLATFORM,
      type: pool.gameCount >= 15 ? "WEEKLY" : "DAILY",
      label: pool.name || `Shabiki ${pool.gameCount}-game jackpot`,
      games: (pool.matches || pool.games || []).map((g, i) => ({
        position: g.position ?? i + 1,
        homeTeam: g.homeTeamName || g.home,
        awayTeam: g.awayTeamName || g.away,
      })),
    }));
  } catch (err) {
    console.error(`[jackpotSources:${PLATFORM}] fetch failed:`, err.message);
    return [];
  }
}

module.exports = { platform: PLATFORM, fetchCurrentJackpots };
