//
// dailyFixtureSync.js only ever walks forward from today, so it never
// seeds historical matches. This backfills real history on demand the
// first time a user opens a fixture's insights tab and caches the result.
const prisma = require("../lib/prisma");
const { getClient } = require("../services/apiSportsClient");
const { mapStatus } = require("../lib/fixtureStatus");
const { normalizeFixture } = require("../lib/normalizeFixture");
const { upsertLeague, upsertTeam } = require("../jobs/dailyFixtureSync");

const MIN_CACHED_MEETINGS = 3; // below this, worth spending an API call to check for more
const RECHECK_AFTER_DAYS = 30; // pairs with genuinely no shared history aren't re-queried more than this often

function pairKey(teamAId, teamBId) {
  return teamAId < teamBId ? [teamAId, teamBId] : [teamBId, teamAId];
}

/**
 * Ensures the DB has real historical H2H data for this fixture's two
 * teams, fetching from API-Sports if needed. Football only.
 */
async function ensureH2hData(fixture) {
  if (fixture.sport !== "FOOTBALL") return;

  const [teamAId, teamBId] = pairKey(fixture.homeTeamId, fixture.awayTeamId);

  const existingMeetings = await prisma.fixture.count({
    where: {
      status: "FINISHED",
      OR: [
        { homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId },
        { homeTeamId: fixture.awayTeamId, awayTeamId: fixture.homeTeamId },
      ],
    },
  });
  if (existingMeetings >= MIN_CACHED_MEETINGS) return;

  const lookup = await prisma.h2hLookup.findUnique({ where: { teamAId_teamBId: { teamAId, teamBId } } });
  if (lookup) {
    const ageDays = (Date.now() - lookup.lastCheckedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < RECHECK_AFTER_DAYS) return; // already checked recently, don't burn quota re-asking
  }

  try {
    const client = getClient("FOOTBALL");
    const rawMeetings = await client.getHeadToHead(fixture.homeTeam.apiId, fixture.awayTeam.apiId);

    for (const raw of rawMeetings) {
      const item = normalizeFixture("FOOTBALL", raw);
      if (!item || item.apiId === undefined || item.apiId === null) continue;

      const league = await upsertLeague("FOOTBALL", item.league);
      const homeTeam = await upsertTeam("FOOTBALL", item.homeTeam);
      const awayTeam = await upsertTeam("FOOTBALL", item.awayTeam);

      const parsedElapsed =
        item.elapsed !== null && item.elapsed !== undefined && item.elapsed !== "" && !isNaN(item.elapsed)
          ? parseInt(String(item.elapsed), 10)
          : null;

      await prisma.fixture.upsert({
        where: { apiId_sport_provider: { apiId: Number(item.apiId), sport: "FOOTBALL", provider: "API_SPORTS" } },
        update: {
          status: mapStatus(item.statusShort),
          homeScore: item.homeScore,
          awayScore: item.awayScore,
          elapsed: parsedElapsed,
        },
        create: {
          apiId: Number(item.apiId),
          sport: "FOOTBALL",
          leagueId: league.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          kickoff: new Date(item.kickoff),
          status: mapStatus(item.statusShort),
          homeScore: item.homeScore,
          awayScore: item.awayScore,
          elapsed: parsedElapsed,
        },
      });
    }

    await prisma.h2hLookup.upsert({
      where: { teamAId_teamBId: { teamAId, teamBId } },
      update: { meetingsFound: rawMeetings.length, lastCheckedAt: new Date() },
      create: { teamAId, teamBId, meetingsFound: rawMeetings.length, lastCheckedAt: new Date() },
    });
  } catch (err) {
    console.error(`[h2hBackfill] failed for teams ${fixture.homeTeamId}/${fixture.awayTeamId}:`, err.message);
    // Mark lookup attempt so quota failures don't re-trigger requests on every single view
    try {
      await prisma.h2hLookup.upsert({
        where: { teamAId_teamBId: { teamAId, teamBId } },
        update: { lastCheckedAt: new Date() },
        create: { teamAId, teamBId, meetingsFound: 0, lastCheckedAt: new Date() },
      });
    } catch (dbErr) {}
  }
}

module.exports = { ensureH2hData };