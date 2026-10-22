const prisma = require("../lib/prisma");
const predictionEngine = require("../services/predictionEngine");
const { expectedGameCount, isKnownCombo, HISTORY_RETENTION } = require("../config/jackpotPlatforms");
const { normalizeTeamName } = require("../lib/teamNameNormalize");
const { SPORTS } = require("../config/sports");

// How far ahead a jackpot fixture can be when we're fuzzy-matching by
// team name instead of an explicit apiFixtureId.
const MATCH_WINDOW_DAYS = 14;

// Placeholder League every auto-created jackpot-only fixture is filed
// under (see resolveOrCreateFixture) — kept as a single well-known row
// (apiId 0, JACKPOT_MANUAL provider) rather than creating a new League
// per platform, so these are trivially identifiable/queryable later.
const PLACEHOLDER_LEAGUE = { apiId: 0, sport: "FOOTBALL", provider: "JACKPOT_MANUAL" };

// No real kickoff time is known for an auto-created jackpot-only fixture
// (adapters currently only supply team names/positions, not kickoff) —
// this default pushes it far enough out that getTeamForm/getRestDays
// still treat it sanely as "upcoming", while daily sync + re-ingestion
// have a chance to attach the real kickoff once the fixture shows up
// through the normal pipeline.
const PLACEHOLDER_KICKOFF_DAYS_AHEAD = 5;

/** Simple deterministic string hash (djb2), used to derive stable synthetic
 * apiIds for auto-created teams/fixtures so re-ingesting the same jackpot
 * round doesn't create duplicate placeholder rows. */
function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Keep it a positive 31-bit int — fits a MySQL INT column comfortably.
  return Math.abs(hash) % 2147483647;
}

async function findOrCreatePlaceholderLeague() {
  return prisma.league.upsert({
    where: { apiId_sport_provider: { apiId: PLACEHOLDER_LEAGUE.apiId, sport: PLACEHOLDER_LEAGUE.sport, provider: PLACEHOLDER_LEAGUE.provider } },
    update: {},
    create: {
      ...PLACEHOLDER_LEAGUE,
      name: "Unmatched (auto-created from jackpot sync)",
      country: "—",
      tier: "TIER_4",
    },
  });
}

/** Finds an existing team by fuzzy name match (any provider), or creates a
 * JACKPOT_MANUAL placeholder team keyed off a stable hash of the name. */
async function findOrCreateTeam(teamName) {
  const want = normalizeTeamName(teamName);
  const candidates = await prisma.team.findMany({ where: { sport: "FOOTBALL" }, select: { id: true, name: true } });
  const match = candidates.find((t) => {
    const n = normalizeTeamName(t.name);
    return n && want && (n.includes(want) || want.includes(n));
  });
  if (match) return prisma.team.findUnique({ where: { id: match.id } });

  const apiId = stableHash(`team:${want}`);
  return prisma.team.upsert({
    where: { apiId_sport_provider: { apiId, sport: "FOOTBALL", provider: "JACKPOT_MANUAL" } },
    update: {},
    create: { apiId, sport: "FOOTBALL", provider: "JACKPOT_MANUAL", name: teamName },
  });
}

/**
 * UPGRADE (Task 4): a jackpot leg no longer needs a pre-existing Fixture
 * row. When findFixtureForGame() can't match one, this resolves (or
 * creates) the two Team rows and a minimal placeholder Fixture so the
 * prediction engine can run immediately — no manual trigger, no fixture
 * dependency check, no dropped/"unmatched" game. If the real fixture
 * later appears through the normal daily sync, re-ingesting this same
 * jackpot round will re-run findFixtureForGame first and pick that real
 * fixture up on the next pass (this placeholder is simply superseded,
 * not deleted).
 */
async function resolveOrCreateFixture(game) {
  const [league, homeTeam, awayTeam] = await Promise.all([
    findOrCreatePlaceholderLeague(),
    findOrCreateTeam(game.homeTeam),
    findOrCreateTeam(game.awayTeam),
  ]);

  const apiId = stableHash(`fixture:${homeTeam.id}:${awayTeam.id}:${game.position}`);
  const kickoff = game.kickoff ? new Date(game.kickoff) : new Date(Date.now() + PLACEHOLDER_KICKOFF_DAYS_AHEAD * 24 * 60 * 60 * 1000);

  return prisma.fixture.upsert({
    where: { apiId_sport_provider: { apiId, sport: "FOOTBALL", provider: "JACKPOT_MANUAL" } },
    update: {},
    create: {
      apiId,
      sport: "FOOTBALL",
      provider: "JACKPOT_MANUAL",
      leagueId: league.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoff,
      status: "SCHEDULED",
    },
  });
}

/**
 * Routes to the correct prediction engine for this fixture's sport —
 * same routing dailyFixtureSync.js uses (Task 3): football gets the
 * full Poisson model, other draw-supporting sports (handball, rugby,
 * AFL) get the 3-way model, everything else gets the 2-way model.
 * Jackpot legs are football-only for SportPesa/Betika/Mozzart/Shabiki
 * today, but routing on fixture.sport rather than assuming football
 * keeps this correct if that ever changes (or for a manually
 * quick-pasted non-football pool).
 */
async function generatePredictionForSport(fixture) {
  if (fixture.sport === "FOOTBALL") return predictionEngine.generatePrediction(fixture);
  const sportConfig = SPORTS[fixture.sport];
  return sportConfig?.supportsDraw
    ? predictionEngine.generateThreeWayPrediction(fixture)
    : predictionEngine.generateTwoWayPrediction(fixture);
}

/**
 * Resolves one jackpot pool entry to a local Fixture row.
 * Prefers an explicit apiFixtureId (exact, free); falls back to a fuzzy
 * team-name match within the next MATCH_WINDOW_DAYS against fixtures we
 * already have from the daily sync (still zero extra API calls).
 */
async function findFixtureForGame(game) {
  if (game.apiFixtureId) {
    return prisma.fixture.findUnique({
      where: { apiId_sport_provider: { apiId: game.apiFixtureId, sport: "FOOTBALL", provider: "API_SPORTS" } },
    });
  }

  const windowEnd = new Date(Date.now() + MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.fixture.findMany({
    where: { kickoff: { gte: new Date(), lte: windowEnd } },
    include: { homeTeam: true, awayTeam: true },
  });

  const wantHome = normalizeTeamName(game.homeTeam);
  const wantAway = normalizeTeamName(game.awayTeam);

  return (
    candidates.find((f) => {
      const home = normalizeTeamName(f.homeTeam.name);
      const away = normalizeTeamName(f.awayTeam.name);
      return (
        (home.includes(wantHome) || wantHome.includes(home)) &&
        (away.includes(wantAway) || wantAway.includes(away))
      );
    }) || null
  );
}

/**
 * Parses a loosely-formatted pasted game list into the same
 * {position, homeTeam, awayTeam} shape ingestJackpot expects. Built for
 * the quick-paste admin flow — you copy the jackpot's game list from
 * wherever you can see it (the app, a screenshot you typed out, an SMS)
 * and paste it as plain text instead of hand-writing JSON.
 *
 * Accepts, per line, any of:
 *   "1. Manchester United vs Chelsea"
 *   "2) Arsenal - Liverpool"
 *   "Real Madrid v Barcelona"          (no number — auto-numbered in order)
 *   "Bayern Munich VS Dortmund"        (case-insensitive separator)
 * Blank lines and lines that don't contain a recognizable separator are
 * skipped (reported back in `skipped` so the caller can see what didn't
 * parse rather than silently losing a game).
 *
 * @param {string} rawText
 * @returns {{ games: Array<{position:number, homeTeam:string, awayTeam:string}>, skipped: string[] }}
 */
function parseQuickPasteText(rawText) {
  const lines = (rawText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const games = [];
  const skipped = [];
  let autoPosition = 0;

  // Matches an optional leading "12." / "12)" / "12 -" position marker,
  // then two team names separated by vs/v/- (any casing, with or without
  // surrounding whitespace/periods).
  const lineRegex = /^(?:(\d{1,2})\s*[.)\-:]?\s+)?(.+?)\s+(?:vs\.?|v\.?|-)\s+(.+)$/i;

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (!match) {
      skipped.push(line);
      continue;
    }
    const [, explicitPosition, homeTeam, awayTeam] = match;
    autoPosition += 1;
    games.push({
      position: explicitPosition ? Number(explicitPosition) : autoPosition,
      homeTeam: homeTeam.trim(),
      awayTeam: awayTeam.trim(),
    });
  }

  return { games, skipped };
}

/**
 * @param {object} payload
 * @param {"SPORTPESA"|"BETIKA"|"MOZZART"|"SHABIKI"} payload.platform
 * @param {"MIDWEEK"|"MEGA"|"GRAND"|"DAILY"|"WEEKLY"} payload.type
 * @param {string} payload.label
 * @param {Array<{position:number, homeTeam:string, awayTeam:string, apiFixtureId?:number}>} payload.games
 * @param {"NEEDS_REVIEW"|"OPEN"} [payload.initialStatus="OPEN"] - status
 *   assigned ONLY if this call creates a new jackpot row. Applied on
 *   create only, never on update — re-ingesting an existing label (e.g.
 *   a source adapter refreshing odds/kickoff times) must never silently
 *   flip an already-approved OPEN jackpot back to hidden.
 */
async function ingestJackpot(payload) {
  const { platform, type, label, games, initialStatus = "OPEN" } = payload;

  // Every platform runs its own jackpot "strategy" (game count, cadence,
  // which types it even offers) — warn loudly rather than silently
  // accepting a payload that doesn't match what we know that platform
  // actually publishes, since that usually means a copy/paste mistake
  // between platforms rather than a real format change.
  if (!isKnownCombo(platform, type)) {
    console.warn(`[ingest] ${platform} doesn't normally run a "${type}" jackpot — proceeding anyway, but double-check the source.`);
  } else {
    const expected = expectedGameCount(platform, type);
    if (expected && games.length !== expected) {
      console.warn(`[ingest] ${platform} ${type} jackpots are normally ${expected} games, got ${games.length} — proceeding anyway.`);
    }
  }

  const jackpot = await prisma.jackpot.upsert({
    where: { platform_type_label: { platform, type, label } },
    update: { totalGames: games.length },
    create: { platform, type, label, totalGames: games.length, status: initialStatus },
  });

  // One-time diagnostic per ingest run: if this is 0, every game below is
  // guaranteed to go unmatched regardless of team-name quality — that's
  // "the fixture sync hasn't populated this window yet", not a name-
  // matching bug, and worth knowing before staring at team-name diffs.
  const windowEnd = new Date(Date.now() + MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidateCount = await prisma.fixture.count({ where: { kickoff: { gte: new Date(), lte: windowEnd } } });
  console.log(`[ingest] ${platform} ${type}: ${candidateCount} fixture(s) on file in the next ${MATCH_WINDOW_DAYS} days to match against`);

  const matched = [];
  let autoCreatedCount = 0;

  for (const game of games) {
    let fixture = await findFixtureForGame(game);
    let autoCreated = false;

    if (!fixture) {
      // No pre-existing fixture in our DB (common for Tier 3/4 pools, or
      // legs whose kickoff falls outside the daily sync's rolling
      // window) — auto-create the team/fixture references instead of
      // dropping the leg, per Task 4: ingestion must never require the
      // game to already exist.
      fixture = await resolveOrCreateFixture(game);
      autoCreated = true;
      autoCreatedCount += 1;
    }

    // Backfill a prediction now if this fixture doesn't have one yet —
    // still zero API cost, the engine only reads fixtures already in our
    // DB — then run it immediately regardless of matched/auto-created
    // status, so every leg gets analysis in the same pass as ingestion.
    let prediction = await prisma.prediction.findUnique({ where: { fixtureId: fixture.id } });
    if (!prediction) {
      const result = await generatePredictionForSport(fixture);
      prediction = await prisma.prediction.create({ data: { fixtureId: fixture.id, ...result } });
    }

    // Store the analysis directly on the JackpotSelection ("JackpotItem")
    // itself — the Jackpots tab reads it straight off this row, with no
    // extra fixture/prediction join or on-demand generation required.
    const analysisSnapshot = {
      analysisProbHome: prediction.probHome,
      analysisProbDraw: prediction.probDraw,
      analysisProbAway: prediction.probAway,
      analysisPredictedOutcome: prediction.predictedOutcome,
      analysisConfidence: prediction.confidence,
      analysisJustification: prediction.justification,
      analyzedAt: new Date(),
    };

    await prisma.jackpotSelection.upsert({
      where: { jackpotId_position: { jackpotId: jackpot.id, position: game.position } },
      update: { fixtureId: fixture.id, ...analysisSnapshot },
      create: { jackpotId: jackpot.id, position: game.position, fixtureId: fixture.id, ...analysisSnapshot },
    });

    matched.push({ position: game.position, fixtureId: fixture.id, autoCreated });
  }

  return { jackpotId: jackpot.id, matchedCount: matched.length, autoCreatedCount, unmatched: [] };
}

/**
 * Every bookmaker's jackpot page only shows the CURRENT round — once it
 * settles, the old one is gone from their site. This is the "so incase
 * one wants to confirm he can confirm" feature: keep the last N rounds
 * for a platform+type on OUR side, with the settled result, so a user
 * can check "did last week's Mozzart Midweek actually land 13/15" days
 * after Mozzart itself has moved on to the next one.
 *
 * @param {"SPORTPESA"|"BETIKA"|"MOZZART"|"SHABIKI"} platform
 * @param {"MIDWEEK"|"MEGA"|"GRAND"|"DAILY"|"WEEKLY"} type
 * @param {number} [excludeId] - omit the currently-open/viewed jackpot from its own history list
 * @param {number} [limit]
 */
async function getJackpotHistory(platform, type, excludeId = null, limit = HISTORY_RETENTION) {
  const jackpots = await prisma.jackpot.findMany({
    where: {
      platform,
      type,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      label: true,
      status: true,
      totalGames: true,
      correctCount: true,
      settledAt: true,
      createdAt: true,
    },
  });

  return jackpots.map((j) => ({
    ...j,
    // Explicit null (not 0) until settlementJob has actually confirmed
    // it — the frontend should render "pending" rather than "0/17".
    correctCount: j.status === "SETTLED" ? j.correctCount : null,
  }));
}

/** Lists jackpots awaiting admin approval (from quick-paste or auto-source ingestion). */
async function getPendingReview() {
  return prisma.jackpot.findMany({
    where: { status: "NEEDS_REVIEW" },
    orderBy: { createdAt: "desc" },
    include: {
      selections: {
        orderBy: { position: "asc" },
        include: { fixture: { include: { homeTeam: true, awayTeam: true } } },
      },
    },
  });
}

/** Approves a NEEDS_REVIEW jackpot, making it visible on the public jackpot list. */
async function approveJackpot(jackpotId) {
  const jackpot = await prisma.jackpot.findUnique({ where: { id: jackpotId } });
  if (!jackpot) throw new Error("jackpot not found");
  if (jackpot.status !== "NEEDS_REVIEW") throw new Error(`jackpot is already ${jackpot.status}, nothing to approve`);
  return prisma.jackpot.update({ where: { id: jackpotId }, data: { status: "OPEN" } });
}

module.exports = {
  ingestJackpot,
  findFixtureForGame,
  getJackpotHistory,
  parseQuickPasteText,
  getPendingReview,
  approveJackpot,
};