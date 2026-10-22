const prisma = require("../lib/prisma");
const footballData = require("../services/footballDataClient");

/**
 * Refreshes StandingsCache for the small set of top-tier competitions we
 * show tables for. Runs on its own schedule (see scheduler.js) — each
 * call costs one football-data.org request, and the client's built-in
 * rate limiter keeps this (and every other footballDataClient caller)
 * under the provider's 10-requests/minute ceiling regardless of overlap.
 */
async function runStandingsSync() {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    console.log("[standingsSync] FOOTBALL_DATA_TOKEN not set — skipping");
    return;
  }

  let updated = 0;
  for (const code of footballData.STANDINGS_COMPETITIONS) {
    try {
      const standings = await footballData.getStandings(code);
      if (!standings || !standings.competitionApiId) continue;

      const league = await prisma.league.findFirst({
        where: { apiId: standings.competitionApiId, sport: "FOOTBALL", provider: "FOOTBALL_DATA" },
      });
      if (!league) continue; // not synced by footballDataSync yet — skip until it is

      await prisma.standingsCache.upsert({
        where: { leagueId_season: { leagueId: league.id, season: standings.season } },
        update: { data: standings.table },
        create: { leagueId: league.id, season: standings.season, data: standings.table },
      });
      updated += 1;
    } catch (err) {
      console.error(`[standingsSync] failed for ${code}:`, err.message);
    }
  }

  console.log(`[standingsSync] refreshed ${updated}/${footballData.STANDINGS_COMPETITIONS.length} competitions`);
}

module.exports = { runStandingsSync };
