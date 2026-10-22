const prisma = require("../lib/prisma");
const footballData = require("../services/footballDataClient");
const predictionEngine = require("../services/predictionEngine");
const { mapFootballDataStatus } = require("../lib/fixtureStatus");

// One call covers this whole window — football-data.org's free tier
// supports dateFrom/dateTo directly, unlike API-Football's single-date
// free-tier endpoint. This is the entire reason major leagues are routed
// here: wider coverage for less quota.
const SYNC_WINDOW_DAYS = Number(process.env.FOOTBALL_DATA_WINDOW_DAYS || 10);

function dateStringOffset(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

async function upsertLeague(match) {
  const comp = match.competition;
  return prisma.league.upsert({
    where: { apiId_sport_provider: { apiId: comp.id, sport: "FOOTBALL", provider: "FOOTBALL_DATA" } },
    update: { name: comp.name, logoUrl: comp.emblem },
    create: {
      apiId: comp.id,
      sport: "FOOTBALL",
      provider: "FOOTBALL_DATA",
      name: comp.name,
      country: comp.area?.name || "Europe",
      logoUrl: comp.emblem,
      tier: footballData.tierForCompetitionCode(comp.code),
    },
  });
}

async function upsertTeam(team) {
  return prisma.team.upsert({
    where: { apiId_sport_provider: { apiId: team.id, sport: "FOOTBALL", provider: "FOOTBALL_DATA" } },
    update: { name: team.name, logoUrl: team.crest },
    create: { apiId: team.id, sport: "FOOTBALL", provider: "FOOTBALL_DATA", name: team.name, logoUrl: team.crest },
  });
}

/**
 * Runs on its own frequent schedule (its per-minute pool, not the daily
 * API-Football budget — see scheduler.js). Re-fetching the whole window
 * each time is intentional: it's how this job stays fresh (including
 * live status/score changes) without needing a separate live-poll path
 * for major leagues at all.
 */
async function runFootballDataSync() {
  let status = "success";
  let errorMessage = null;
  let fixturesIn = 0;
  let predictionsOut = 0;

  if (!process.env.FOOTBALL_DATA_TOKEN) {
    console.log("[footballDataSync] FOOTBALL_DATA_TOKEN not set — skipping (Provider 1 disabled)");
    return;
  }

  try {
    const dateFrom = dateStringOffset(0);
    const dateTo = dateStringOffset(SYNC_WINDOW_DAYS);
    const matches = await footballData.getMatches(dateFrom, dateTo);
    fixturesIn = matches.length;

    for (const match of matches) {
      const league = await upsertLeague(match);
      const homeTeam = await upsertTeam(match.homeTeam);
      const awayTeam = await upsertTeam(match.awayTeam);

      const fixture = await prisma.fixture.upsert({
        where: { apiId_sport_provider: { apiId: match.id, sport: "FOOTBALL", provider: "FOOTBALL_DATA" } },
        update: {
          kickoff: new Date(match.utcDate),
          status: mapFootballDataStatus(match.status),
          homeScore: match.score?.fullTime?.home ?? null,
          awayScore: match.score?.fullTime?.away ?? null,
        },
        create: {
          apiId: match.id,
          sport: "FOOTBALL",
          provider: "FOOTBALL_DATA",
          leagueId: league.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          kickoff: new Date(match.utcDate),
          status: mapFootballDataStatus(match.status),
          homeScore: match.score?.fullTime?.home ?? null,
          awayScore: match.score?.fullTime?.away ?? null,
        },
      });

      if (league.tier === "TIER_1" || league.tier === "TIER_2") {
        const existing = await prisma.prediction.findUnique({ where: { fixtureId: fixture.id } });
        if (!existing) {
          const result = await predictionEngine.generatePrediction(fixture);
          await prisma.prediction.create({ data: { fixtureId: fixture.id, ...result } });
          predictionsOut += 1;
        }
      }
    }
  } catch (err) {
    status = "failed";
    errorMessage = err.message;
    console.error("[footballDataSync] failed:", err);
  }

  await prisma.syncLog.create({
    data: {
      jobName: "footballDataSync",
      apiCallsUsed: footballData.getCallCount(),
      fixturesIn,
      predictionsOut,
      status,
      errorMessage,
    },
  });

  console.log(`[footballDataSync] window=${SYNC_WINDOW_DAYS}d fixtures=${fixturesIn} predictions=${predictionsOut} status=${status}`);
}

module.exports = { runFootballDataSync };
