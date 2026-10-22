const prisma = require("../lib/prisma");
const { getClient } = require("../services/apiSportsClient");
const espnClient = require("../services/espnClient");
const { mapStatus } = require("../lib/fixtureStatus");
const { normalizeFixture } = require("../lib/normalizeFixture");
const { recomputeSiteStats } = require("../services/siteStats");

const BATCH_SIZE = 20; // API-Sports' max ids-per-request

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function deriveOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return "HOME";
  if (homeScore < awayScore) return "AWAY";
  return "DRAW";
}

/** Settles a fixture's prediction (if it has one) against its final score. Pure DB write, no API call. */
async function settlePrediction(fixtureId, prediction, homeScore, awayScore) {
  if (!prediction) return false;
  const actualOutcome = deriveOutcome(homeScore, awayScore);
  const bttsActual = prediction.bttsYesProb !== null ? homeScore > 0 && awayScore > 0 : null;

  await prisma.prediction.update({
    where: { fixtureId },
    data: {
      actualOutcome,
      isCorrect: actualOutcome === prediction.predictedOutcome,
      bttsActual,
      bttsCorrect: bttsActual !== null ? bttsActual === prediction.predictedBtts : null,
      settledAt: new Date(),
    },
  });
  return true;
}

/**
 * Football settlement — ESPN-first, three tiers:
 *  1. Fixtures already FINISHED in our own DB (the ESPN 20s ticker and
 *     football-data's 1-min sync both write final scores independently
 *     of this job) settle straight off what's already there — zero API
 *     calls of any kind.
 *  2. Whatever's still LIVE/pending after that gets ONE more direct,
 *     unmetered ESPN lookup by team name — catches tickers that missed a
 *     fuzzy name match, or a match that only just finished.
 *  3. True stragglers (small leagues ESPN doesn't carry, or a lookup
 *     that still came back empty) are the ONLY thing that spends
 *     API-Sports quota here, batched up to 20 ids per call.
 */
async function settleFootball(fixtures) {
  let settled = 0;
  let apiCallsUsed = 0;
  const stillPending = [];

  // Tier 1: already finished in our DB.
  for (const f of fixtures) {
    if (f.status === "FINISHED" && f.homeScore != null && f.awayScore != null) {
      if (await settlePrediction(f.id, f.prediction, f.homeScore, f.awayScore)) settled += 1;
    } else {
      stillPending.push(f);
    }
  }

  // Tier 2: one direct ESPN lookup per straggler (unmetered).
  const trueStragglers = [];
  for (const f of stillPending) {
    const insights = await espnClient.getInsightsByTeams(f.homeTeam.name, f.awayTeam.name);
    const finished = insights.available && insights.statusState === "post" && insights.homeScore != null && insights.awayScore != null;

    if (finished) {
      const homeScore = Number(insights.homeScore);
      const awayScore = Number(insights.awayScore);
      await prisma.fixture.update({
        where: { id: f.id },
        data: { status: "FINISHED", homeScore, awayScore },
      });
      if (await settlePrediction(f.id, f.prediction, homeScore, awayScore)) settled += 1;
    } else {
      trueStragglers.push(f);
    }
  }

  // Tier 3: last-resort API-Sports batch — only for API_SPORTS-provider
  // stragglers. Football-data-sourced fixtures use a different apiId
  // numbering scheme entirely, so sending those to API-Sports would just
  // silently miss (wasting a call); they're left for footballDataSync's
  // own 1-minute cycle to pick up instead.
  const apiSportsStragglers = trueStragglers.filter((f) => f.provider === "API_SPORTS");

  if (apiSportsStragglers.length > 0) {
    const client = getClient("FOOTBALL");
    const byApiId = new Map(apiSportsStragglers.map((f) => [f.apiId, f]));
    const batches = chunk(apiSportsStragglers.map((f) => f.apiId), BATCH_SIZE);

    for (const batch of batches) {
      const rawResults = await client.getFixturesByIds(batch);
      for (const raw of rawResults) {
        const item = normalizeFixture("FOOTBALL", raw);
        const localFixture = byApiId.get(item.apiId);
        if (!localFixture) continue;

        const newStatus = mapStatus(item.statusShort);
        await prisma.fixture.update({
          where: { id: localFixture.id },
          data: { status: newStatus, homeScore: item.homeScore, awayScore: item.awayScore, elapsed: item.elapsed },
        });

        if (newStatus === "FINISHED" && item.homeScore != null && item.awayScore != null) {
          if (await settlePrediction(localFixture.id, localFixture.prediction, item.homeScore, item.awayScore)) settled += 1;
        }
      }
    }
    apiCallsUsed = client.getCallCount();
  }

  return { checked: fixtures.length, settled, apiCallsUsed };
}

/**
 * Non-football settlement — unchanged from before. ESPN's integration in
 * this codebase is soccer-only, so basketball/hockey/etc. still rely on
 * API-Sports' batch-by-id endpoint as their only live/final-score check.
 * This runs on the same 30-min cadence as football settlement, and at
 * that frequency comfortably stays inside each sport's own 100/day quota
 * (they're metered separately, one key per sport product).
 */
async function settleOtherSport(sport, fixtures) {
  const client = getClient(sport);
  const byApiId = new Map(fixtures.map((f) => [f.apiId, f]));
  const batches = chunk(fixtures.map((f) => f.apiId), BATCH_SIZE);
  let settled = 0;

  for (const batch of batches) {
    const rawResults = await client.getFixturesByIds(batch);
    for (const raw of rawResults) {
      const item = normalizeFixture(sport, raw);
      const localFixture = byApiId.get(item.apiId);
      if (!localFixture) continue;

      const newStatus = mapStatus(item.statusShort);
      const parsedElapsed =
        item.elapsed !== null && item.elapsed !== undefined && item.elapsed !== "" && !isNaN(item.elapsed)
          ? parseInt(String(item.elapsed), 10)
          : null;
      await prisma.fixture.update({
        where: { id: localFixture.id },
        data: { status: newStatus, homeScore: item.homeScore, awayScore: item.awayScore, elapsed: parsedElapsed, periodLabel: item.periodLabel },
      });

      if (newStatus !== "FINISHED" || item.homeScore === null || item.awayScore === null) continue;

      if (await settlePrediction(localFixture.id, localFixture.prediction, item.homeScore, item.awayScore)) settled += 1;
    }
  }

  return { checked: fixtures.length, settled, apiCallsUsed: client.getCallCount() };
}

/**
 * Once every fixture in a jackpot has finished, tallies how many
 * selections came in as predicted and marks the jackpot SETTLED.
 */
async function settleJackpots() {
  const candidates = await prisma.jackpot.findMany({
    where: { status: { in: ["OPEN", "CLOSED"] } },
    include: { selections: { include: { fixture: { include: { prediction: true } } } } },
  });

  let settledCount = 0;

  for (const jackpot of candidates) {
    if (jackpot.selections.length === 0) continue;
    const allFinished = jackpot.selections.every((s) => s.fixture.status === "FINISHED");
    if (!allFinished) continue;

    const correctCount = jackpot.selections.reduce(
      (acc, s) => acc + (s.fixture.prediction?.isCorrect ? 1 : 0),
      0
    );

    await prisma.jackpot.update({
      where: { id: jackpot.id },
      data: { status: "SETTLED", correctCount, settledAt: new Date() },
    });

    settledCount += 1;
  }

  if (settledCount > 0) console.log(`[settlementJob] settled ${settledCount} jackpot(s)`);
  return settledCount;
}

/**
 * Runs every 30 minutes (see scheduler.js). Checks matches currently LIVE
 * or SCHEDULED matches whose kickoff time has arrived, settles finished
 * ones, and rolls up jackpot results.
 */
async function runSettlementJob() {
  const now = new Date();

  const pending = await prisma.fixture.findMany({
    where: {
      OR: [
        { status: "LIVE" },
        { status: "HALFTIME" },
        { status: "SCHEDULED", kickoff: { lte: now } },
      ],
    },
    include: { prediction: true, homeTeam: true, awayTeam: true },
  });

  const bySport = new Map();
  for (const f of pending) {
    if (!bySport.has(f.sport)) bySport.set(f.sport, []);
    bySport.get(f.sport).push(f);
  }

  for (const [sport, fixtures] of bySport) {
    let status = "success";
    let errorMessage = null;
    let result = { checked: fixtures.length, settled: 0, apiCallsUsed: 0 };

    try {
      result = sport === "FOOTBALL" ? await settleFootball(fixtures) : await settleOtherSport(sport, fixtures);
    } catch (err) {
      status = "failed";
      errorMessage = err.message;
      console.error(`[settlementJob:${sport}] failed:`, err);
    }

    await prisma.syncLog.create({
      data: {
        jobName: `settlementJob:${sport}`,
        apiCallsUsed: result.apiCallsUsed,
        fixturesIn: result.checked,
        predictionsOut: result.settled,
        status,
        errorMessage,
      },
    });

    console.log(`[settlementJob:${sport}] checked=${result.checked} settled=${result.settled} apiCalls=${result.apiCallsUsed} status=${status}`);
  }

  await settleJackpots();
  await recomputeSiteStats();
}

module.exports = { runSettlementJob, settleJackpots };
