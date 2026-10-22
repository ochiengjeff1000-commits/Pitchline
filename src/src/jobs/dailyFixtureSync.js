const prisma = require("../lib/prisma");
const { getClient } = require("../services/apiSportsClient");
const predictionEngine = require("../services/predictionEngine");
const { tierForLeague } = require("../config/leagueTiers");
const { mapStatus } = require("../lib/fixtureStatus");
const { normalizeFixture } = require("../lib/normalizeFixture");
const { enabledSports, SPORTS } = require("../config/sports");

const SYNC_WINDOW_DAYS = Number(process.env.SYNC_WINDOW_DAYS || 7);

// Free tier on API-Sports restricts date queries for non-football sports to today (1 day).
// Keeping all sports window bounded avoids plan errors.
function daysForSport(sport) {
  return sport === "FOOTBALL" ? 1 : 1;
}

function dateStringOffset(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function upsertLeague(sport, league) {
  const leagueName = league.name || "Unknown League";
  const leagueCountry = league.country || "Unknown";

  return prisma.league.upsert({
    where: { apiId_sport_provider: { apiId: league.apiId, sport, provider: "API_SPORTS" } },
    update: { name: leagueName, country: leagueCountry, logoUrl: league.logo },
    create: {
      apiId: league.apiId,
      sport,
      name: leagueName,
      country: leagueCountry,
      logoUrl: league.logo,
      tier: tierForLeague(league.apiId, sport, leagueName),
    },
  });
}

async function upsertTeam(sport, team) {
  return prisma.team.upsert({
    where: { apiId_sport_provider: { apiId: team.apiId, sport, provider: "API_SPORTS" } },
    update: { name: team.name, logoUrl: team.logo },
    create: { apiId: team.apiId, sport, name: team.name, logoUrl: team.logo },
  });
}

/**
 * Syncs one sport for one date. Costs exactly 1 API request against
 * that sport's own quota.
 */
async function syncSportForDate(sport, date) {
  const client = getClient(sport);
  const sportConfig = SPORTS[sport];
  const rawFixtures = await client.getFixturesByDate(date);
  const savedFixtures = [];

  for (const raw of rawFixtures) {
    const item = normalizeFixture(sport, raw);

    // Skip malformed entries missing valid apiId (e.g. AFL unmapped objects)
    if (!item || item.apiId === undefined || item.apiId === null) {
      console.warn(`[dailyFixtureSync:${sport}] Skipped item missing valid apiId on date ${date}`);
      continue;
    }

    const league = await upsertLeague(sport, item.league);
    const homeTeam = await upsertTeam(sport, item.homeTeam);
    const awayTeam = await upsertTeam(sport, item.awayTeam);

    // Ensure elapsed is strictly an Integer or null for Prisma
    const parsedElapsed =
      item.elapsed !== null && item.elapsed !== undefined && item.elapsed !== "" && !isNaN(item.elapsed)
        ? parseInt(String(item.elapsed), 10)
        : null;

    const fixture = await prisma.fixture.upsert({
      where: { apiId_sport_provider: { apiId: Number(item.apiId), sport, provider: "API_SPORTS" } },
      update: {
        kickoff: new Date(item.kickoff),
        status: mapStatus(item.statusShort),
        homeScore: item.homeScore,
        awayScore: item.awayScore,
        elapsed: parsedElapsed,
        periodLabel: item.periodLabel,
      },
      create: {
        apiId: Number(item.apiId),
        sport,
        leagueId: league.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoff: new Date(item.kickoff),
        status: mapStatus(item.statusShort),
        homeScore: item.homeScore,
        awayScore: item.awayScore,
        elapsed: parsedElapsed,
        periodLabel: item.periodLabel,
      },
    });

    savedFixtures.push({ fixture, tier: league.tier });
  }

  // predictionEngine never calls an external API — it only reads fixtures
  // already in our own DB — so there's no quota reason to gate this by
  // league tier. Generate a prediction for every fixture synced.
  let predictionsOut = 0;

  for (const { fixture } of savedFixtures) {
    const existing = await prisma.prediction.findUnique({ where: { fixtureId: fixture.id } });
    if (existing) continue;

    const result =
      sport === "FOOTBALL"
        ? await predictionEngine.generatePrediction(fixture)
        : sportConfig.supportsDraw
          ? await predictionEngine.generateThreeWayPrediction(fixture)
          : await predictionEngine.generateTwoWayPrediction(fixture);

    await prisma.prediction.create({ data: { fixtureId: fixture.id, ...result } });
    predictionsOut += 1;
  }

  return { fixturesIn: rawFixtures.length, predictionsOut };
}

/**
 * Runs daily across every sport in ENABLED_SPORTS.
 */
async function runDailyFixtureSync() {
  const sports = enabledSports();

  for (const sport of sports) {
    let status = "success";
    let errorMessage = null;
    let fixturesIn = 0;
    let predictionsOut = 0;

    try {
      const days = daysForSport(sport);
      for (let i = 0; i < days; i++) {
        const date = dateStringOffset(i);
        const result = await syncSportForDate(sport, date);
        fixturesIn += result.fixturesIn;
        predictionsOut += result.predictionsOut;
      }
    } catch (err) {
      status = "failed";
      errorMessage = err.message;
      console.error(`[dailyFixtureSync:${sport}] failed:`, err);
    }

    const client = getClient(sport);
    await prisma.syncLog.create({
      data: {
        jobName: `dailyFixtureSync:${sport}`,
        apiCallsUsed: client.getCallCount(),
        fixturesIn,
        predictionsOut,
        status,
        errorMessage,
      },
    });

    console.log(
      `[dailyFixtureSync:${sport}] window=${daysForSport(sport)}d fixtures=${fixturesIn} predictions=${predictionsOut} status=${status}`
    );
  }
}

module.exports = { runDailyFixtureSync, syncSportForDate, upsertLeague, upsertTeam };