require("dotenv").config();
const express = require("express");
const path = require("path");
const prisma = require("./lib/prisma");
const { ingestJackpot, getJackpotHistory, parseQuickPasteText, getPendingReview, approveJackpot } = require("./services/jackpotIngestion");
const adminSettings = require("./services/adminSettings");
const { generateSlips } = require("./services/slipGenerator");
const intasend = require("./services/intasendService");
const predictionEngine = require("./services/predictionEngine");
const { generateSquadRecommendation } = require("./services/squadOptimizer");
const { currentGameweek, runFplSquadGen } = require("./jobs/fplSquadGen");
const { enabledSports, SPORTS } = require("./config/sports");
const { platformLabel } = require("./config/jackpotPlatforms");
const { getClient } = require("./services/apiSportsClient");
const { computeMomentum } = require("./lib/momentum");
const { ensureH2hData } = require("./services/h2hBackfill");
const { getTeamProfile } = require("./services/teamProfileService");
const espnClient = require("./services/espnClient");
const { runDailyFixtureSync } = require("./jobs/dailyFixtureSync");
const { runFootballDataSync } = require("./jobs/footballDataSync");
const { runStandingsSync } = require("./jobs/standingsSync");
const { runPostponementCheck } = require("./jobs/postponementCheck");
const { runSettlementJob } = require("./jobs/settlementJob");
const { runEspnLiveTick, runStuckMatchGuard } = require("./jobs/livePollingJob");
const { runNonFootballLiveTick } = require("./jobs/nonFootballLiveTick");
const { runNewsSync } = require("./jobs/newsSync");
const { runFplSync } = require("./jobs/fplSync");
const { runJackpotAutoSync } = require("./jobs/jackpotAutoSync");
const { getAccuracyReport, getBestBet } = require("./services/predictionTrackRecord");

const app = express();
app.use(express.json());

// Serve static frontend files from the 'public' folder at the root directory
app.use(express.static(path.join(__dirname, "../frontend")));

const FREE_TEASER_COUNT = 5;
const LIVE_WINDOW_MINUTES = 130;

function requireAdminKey(req, res, next) {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// ---- Admin: weekly jackpot ingestion (full JSON payload, publishes immediately) ----
app.post("/admin/jackpots/ingest", requireAdminKey, async (req, res) => {
  try {
    const result = await ingestJackpot(req.body);
    res.json(result);
  } catch (err) {
    console.error("[ingest] failed:", err);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: quick-paste ingestion — paste the game list as plain text
// instead of hand-writing JSON. Lands in NEEDS_REVIEW, not visible on the
// public jackpot list until approved (see /admin/jackpots/:id/approve),
// since this path isn't reading from the bookmaker's own verified feed.
app.post("/admin/jackpots/quick-ingest", requireAdminKey, async (req, res) => {
  try {
    const { platform, type, label, text } = req.body;
    if (!platform || !type || !label || !text) {
      return res.status(400).json({ error: "platform, type, label, and text are all required" });
    }

    const { games, skipped } = parseQuickPasteText(text);
    if (games.length === 0) {
      return res.status(400).json({ error: "couldn't parse any games from that text", skipped });
    }

    const result = await ingestJackpot({ platform, type, label, games, initialStatus: "NEEDS_REVIEW" });
    res.json({ ...result, parsedCount: games.length, skipped });
  } catch (err) {
    console.error("[quick-ingest] failed:", err);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: list jackpots awaiting review ----
app.get("/admin/jackpots/pending", requireAdminKey, async (req, res) => {
  try {
    const pending = await getPendingReview();
    res.json(
      pending.map((j) => ({
        id: j.id,
        platform: j.platform,
        type: j.type,
        label: j.label,
        totalGames: j.totalGames,
        matchedCount: j.selections.length,
        unmatchedCount: j.totalGames - j.selections.length,
        // Legs auto-created by jackpotIngestion (no pre-existing fixture
        // found — see resolveOrCreateFixture) carry provider
        // "JACKPOT_MANUAL". Surfacing this lets whoever's reviewing spot
        // placeholder team names before approving, since those haven't
        // been through the daily sync's real team/fixture data yet.
        autoCreatedCount: j.selections.filter((s) => s.fixture.provider === "JACKPOT_MANUAL").length,
        createdAt: j.createdAt,
        selections: j.selections.map((s) => ({
          position: s.position,
          homeTeam: s.fixture.homeTeam.name,
          awayTeam: s.fixture.awayTeam.name,
          kickoff: s.fixture.kickoff,
          autoCreated: s.fixture.provider === "JACKPOT_MANUAL",
        })),
      }))
    );
  } catch (err) {
    console.error("[jackpots pending] failed:", err);
    res.status(500).json({ error: "failed to load pending jackpots" });
  }
});

// ---- Admin: approve a NEEDS_REVIEW jackpot, publishing it ----
app.post("/admin/jackpots/:id/approve", requireAdminKey, async (req, res) => {
  try {
    const jackpot = await approveJackpot(Number(req.params.id));
    res.json({ id: jackpot.id, status: jackpot.status });
  } catch (err) {
    console.error("[jackpot approve] failed:", err);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: reject (delete) a NEEDS_REVIEW jackpot ----
app.delete("/admin/jackpots/:id", requireAdminKey, async (req, res) => {
  try {
    const jackpotId = Number(req.params.id);
    const jackpot = await prisma.jackpot.findUnique({ where: { id: jackpotId } });
    if (!jackpot) return res.status(404).json({ error: "jackpot not found" });
    if (jackpot.status !== "NEEDS_REVIEW") {
      return res.status(400).json({ error: `only NEEDS_REVIEW jackpots can be rejected (this one is ${jackpot.status})` });
    }
    await prisma.jackpotSelection.deleteMany({ where: { jackpotId } });
    await prisma.jackpot.delete({ where: { id: jackpotId } });
    res.json({ deleted: true, id: jackpotId });
  } catch (err) {
    console.error("[jackpot reject] failed:", err);
    res.status(500).json({ error: "failed to reject jackpot" });
  }
});

// ---- Admin: payment settings (unlock price / free mode) ----
app.get("/admin/settings", requireAdminKey, async (req, res) => {
  try {
    res.json(await adminSettings.getAllSettings());
  } catch (err) {
    console.error("[admin settings get] failed:", err);
    res.status(500).json({ error: "failed to load settings" });
  }
});

app.post("/admin/settings", requireAdminKey, async (req, res) => {
  try {
    const { unlockAmountKes } = req.body;
    if (unlockAmountKes !== undefined) await adminSettings.setUnlockAmount(unlockAmountKes);
    res.json(await adminSettings.getAllSettings());
  } catch (err) {
    console.error("[admin settings set] failed:", err);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: dashboard — job health, pending jackpots, quick stats ----
app.get("/admin/dashboard", requireAdminKey, async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [recentLogsRaw, pendingJackpotCount, totalFixtures, totalPredictions, settledPredictions, correctPredictions, activePayments, totalUnlocks] =
      await Promise.all([
        prisma.syncLog.findMany({ orderBy: { runAt: "desc" }, take: 30 }),
        prisma.jackpot.count({ where: { status: "NEEDS_REVIEW" } }),
        prisma.fixture.count(),
        prisma.prediction.count(),
        prisma.prediction.count({ where: { isCorrect: { not: null } } }),
        prisma.prediction.count({ where: { isCorrect: true } }),
        prisma.payment.count({ where: { status: "SUCCESS", createdAt: { gte: since } } }),
        prisma.jackpotUnlock.count(),
      ]);

    // admin.js reads l.createdAt on each log row — map runAt to that key
    // here so the DB's actual column name doesn't leak into the frontend.
    const recentLogs = recentLogsRaw.map((l) => ({ ...l, createdAt: l.runAt }));

    // Failed/erroring jobs in the last 24h — surfaced separately so a
    // silently-broken job doesn't just scroll off the bottom of the log.
    const recentFailures = recentLogs.filter((l) => l.status === "failed" && l.runAt >= since);

    res.json({
      recentLogs,
      recentFailures,
      pendingJackpotCount,
      totalFixtures,
      totalPredictions,
      predictionAccuracy: settledPredictions > 0 ? Math.round((correctPredictions / settledPredictions) * 1000) / 10 : null,
      settledPredictions,
      paymentsLast24h: activePayments,
      totalActiveUnlocks: totalUnlocks,
      settings: await adminSettings.getAllSettings(),
    });
  } catch (err) {
    console.error("[admin dashboard] failed:", err);
    res.status(500).json({ error: "failed to load dashboard" });
  }
});

// ---- Admin: manually trigger any scheduled job on demand ----
const SYNC_JOBS = {
  dailyFixtures: runDailyFixtureSync,
  footballData: runFootballDataSync,
  standings: runStandingsSync,
  postponement: runPostponementCheck,
  settlement: runSettlementJob,
  espnLive: runEspnLiveTick,
  nonFootballLive: runNonFootballLiveTick,
  stuckMatchGuard: runStuckMatchGuard,
  news: runNewsSync,
  fpl: runFplSync,
  fplSquad: runFplSquadGen,
  jackpotAutoSync: runJackpotAutoSync,
};

app.post("/admin/sync/:job", requireAdminKey, async (req, res) => {
  const jobFn = SYNC_JOBS[req.params.job];
  if (!jobFn) {
    return res.status(404).json({ error: `unknown job "${req.params.job}"`, availableJobs: Object.keys(SYNC_JOBS) });
  }
  try {
    await jobFn();
    res.json({ job: req.params.job, status: "completed" });
  } catch (err) {
    console.error(`[admin sync:${req.params.job}] failed:`, err);
    res.status(500).json({ job: req.params.job, status: "failed", error: err.message });
  }
});

// ---- Public: list open/recent jackpots ----
app.get("/api/jackpots", async (req, res) => {
  try {
    const jackpots = await prisma.jackpot.findMany({
      where: { status: { not: "NEEDS_REVIEW" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { selections: { select: { id: true } } },
    });

    res.json(
      jackpots.map((j) => ({
        id: j.id,
        platform: j.platform,
        platformLabel: platformLabel(j.platform),
        type: j.type,
        label: j.label,
        status: j.status,
        totalGames: j.totalGames,
        selectionsLoaded: j.selections.length,
        correctCount: j.status === "SETTLED" ? j.correctCount : null,
        settledAt: j.settledAt,
      }))
    );
  } catch (err) {
    console.error("[jackpots] failed:", err);
    res.status(500).json({ error: "failed to load jackpots" });
  }
});

// ---- Public: jackpot history for past results check ----
app.get("/api/jackpots/history", async (req, res) => {
  try {
    const { platform, type } = req.query;
    if (!platform || !type) return res.status(400).json({ error: "platform and type are required" });

    const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
    const history = await getJackpotHistory(String(platform).toUpperCase(), String(type).toUpperCase(), excludeId);
    res.json({ platform, platformLabel: platformLabel(String(platform).toUpperCase()), type, history });
  } catch (err) {
    console.error("[jackpot history] failed:", err);
    res.status(500).json({ error: "failed to load jackpot history" });
  }
});

// ---- Public: read a jackpot with freemium teaser applied ----
app.get("/api/jackpots/:id", async (req, res) => {
  try {
    const jackpotId = Number(req.params.id);
    const phoneNumber = req.query.phone || null;

    const jackpot = await prisma.jackpot.findUnique({
      where: { id: jackpotId },
      include: {
        selections: {
          orderBy: { position: "asc" },
          include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true, prediction: true } } },
        },
      },
    });

    if (!jackpot) return res.status(404).json({ error: "jackpot not found" });
    if (jackpot.status === "NEEDS_REVIEW") return res.status(404).json({ error: "jackpot not found" }); // not yet published

    const unlocked = await intasend.isUnlocked(jackpotId, phoneNumber);
    // Settled jackpots are historical proof, not something worth paywalling —
    // the whole point of the completed-jackpots accordion (see jackpots.js)
    // is letting anyone confirm what actually landed, so those bypass the
    // freemium teaser lock entirely.
    const isSettled = jackpot.status === "SETTLED";

    const selections = jackpot.selections.map((sel) => {
      const isFree = isSettled || sel.position <= FREE_TEASER_COUNT || unlocked;
      const { fixture } = sel;
      const base = {
        position: sel.position,
        fixtureId: fixture.id,
        kickoff: fixture.kickoff,
        status: fixture.status,
        isLive: computeIsLive(fixture),
        clockMinute: fixture.elapsed,
        periodLabel: fixture.periodLabel,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        homeTeam: fixture.homeTeam.name,
        awayTeam: fixture.awayTeam.name,
        league: fixture.league.name,
      };

      if (!isFree) return { ...base, locked: true };

      return {
        ...base,
        locked: false,
        prediction: fixture.prediction
          ? {
              predictedOutcome: fixture.prediction.predictedOutcome,
              predictedBtts: fixture.prediction.predictedBtts,
              confidence: fixture.prediction.confidence,
              justification: fixture.prediction.justification,
              // Settlement fields — null until settlementJob has actually
              // graded this leg (see Task 2: "WON"/"LOST" badge, and
              // "N/M Correct Picks" summary on the completed accordion).
              actualOutcome: fixture.prediction.actualOutcome,
              isCorrect: fixture.prediction.isCorrect,
            }
          : null,
      };
    });

    const previousResults = await getJackpotHistory(jackpot.platform, jackpot.type, jackpot.id);

    const response = {
      id: jackpot.id,
      platform: jackpot.platform,
      platformLabel: platformLabel(jackpot.platform),
      type: jackpot.type,
      label: jackpot.label,
      status: jackpot.status,
      correctCount: jackpot.status === "SETTLED" ? jackpot.correctCount : null,
      settledAt: jackpot.settledAt,
      unlocked,
      unlockPriceKes: await adminSettings.getUnlockAmount(),
      selections,
      previousResults,
    };

    if (unlocked) {
      response.slips = generateSlips(
        jackpot.selections.map((sel) => ({
          position: sel.position,
          prediction: sel.fixture.prediction,
        }))
      );
    }

    res.json(response);
  } catch (err) {
    console.error("[jackpot detail] failed:", err);
    res.status(500).json({ error: "failed to load jackpot detail" });
  }
});

// ---- Public: trigger STK push via IntaSend ----
app.post("/api/jackpots/:id/unlock", async (req, res) => {
  const jackpotId = Number(req.params.id);
  const { phoneNumber } = req.body;

  if (!phoneNumber || !/^254\d{9}$/.test(phoneNumber)) {
    return res.status(400).json({ error: "phoneNumber must be in 2547XXXXXXXX format" });
  }

  try {
    const result = await intasend.initiateStkPush(jackpotId, phoneNumber);
    if (result.free) {
      return res.json({ message: "Unlocked — this jackpot is currently free.", apiRef: result.apiRef, free: true });
    }
    res.json({ message: "STK push sent — approve the prompt on your phone", apiRef: result.apiRef });
  } catch (err) {
    console.error("[unlock] STK push failed:", err.response?.data || err.message);
    res.status(502).json({ error: "payment provider error, try again" });
  }
});

// ---- IntaSend payment webhook ----
app.post("/api/intasend/webhook", async (req, res) => {
  try {
    await intasend.handleWebhook(req.body);
  } catch (err) {
    console.error("[intasend webhook] error:", err);
  }
  res.status(200).json({ received: true });
});

function computeIsLive(fixture) {
  if (fixture.status === "LIVE" || fixture.status === "HALFTIME") return true;
  if (fixture.status === "FINISHED" || fixture.status === "CANCELLED" || fixture.status === "POSTPONED") {
    return false;
  }
  const now = Date.now();
  const kickoff = new Date(fixture.kickoff).getTime();
  return now >= kickoff && now <= kickoff + LIVE_WINDOW_MINUTES * 60 * 1000;
}

// ---- Public: fixtures grouped by league ----
app.get("/api/fixtures", async (req, res) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const sport = req.query.sport ? String(req.query.sport).toUpperCase() : undefined;

    const fixtures = await prisma.fixture.findMany({
      where: { kickoff: { gte: dayStart, lte: dayEnd }, ...(sport ? { sport } : {}) },
      orderBy: { kickoff: "asc" },
      include: { league: true, homeTeam: true, awayTeam: true, prediction: true },
    });

    const fixtureIds = fixtures.map((f) => f.id);
    const jackpotTagsByFixtureId = new Map();
    if (fixtureIds.length > 0) {
      const openSelections = await prisma.jackpotSelection.findMany({
        where: { fixtureId: { in: fixtureIds }, jackpot: { status: "OPEN" } },
        include: { jackpot: { select: { id: true, platform: true, type: true, label: true } } },
      });
      for (const sel of openSelections) {
        if (!jackpotTagsByFixtureId.has(sel.fixtureId)) jackpotTagsByFixtureId.set(sel.fixtureId, []);
        jackpotTagsByFixtureId.get(sel.fixtureId).push({
          jackpotId: sel.jackpot.id,
          platform: sel.jackpot.platform,
          platformLabel: platformLabel(sel.jackpot.platform),
          type: sel.jackpot.type,
          label: sel.jackpot.label,
          position: sel.position,
        });
      }
    }

    const leaguesById = new Map();
    for (const f of fixtures) {
      if (!leaguesById.has(f.league.id)) {
        leaguesById.set(f.league.id, {
          id: f.league.id,
          sport: f.sport,
          name: f.league.name,
          country: f.league.country,
          logoUrl: f.league.logoUrl,
          tier: f.league.tier,
          fixtures: [],
        });
      }
      leaguesById.get(f.league.id).fixtures.push({
        id: f.id,
        apiId: f.apiId,
        sport: f.sport,
        kickoff: f.kickoff,
        status: f.status,
        isLive: computeIsLive(f),
        clockMinute: f.elapsed,
        periodLabel: f.periodLabel,
        homeTeam: { id: f.homeTeam.id, name: f.homeTeam.name, logoUrl: f.homeTeam.logoUrl },
        awayTeam: { id: f.awayTeam.id, name: f.awayTeam.name, logoUrl: f.awayTeam.logoUrl },
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        prediction: f.prediction
          ? {
              predictedOutcome: f.prediction.predictedOutcome,
              predictedBtts: f.prediction.predictedBtts,
              confidence: f.prediction.confidence,
              probHome: f.prediction.probHome,
              probDraw: f.prediction.probDraw,
              probAway: f.prediction.probAway,
              justification: f.prediction.justification,
            }
          : null,
        jackpots: jackpotTagsByFixtureId.get(f.id) || [],
      });
    }

    const tierOrder = { TIER_1: 0, TIER_2: 1, TIER_3: 2, TIER_4: 3 };
    const leagues = [...leaguesById.values()].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

    res.json({ date: dayStart.toISOString().slice(0, 10), leagues });
  } catch (err) {
    console.error("[fixtures] failed:", err);
    res.status(500).json({ error: "failed to load fixtures" });
  }
});

// ---- Public: single fixture detail view ----
app.get("/api/fixtures/:id", async (req, res) => {
  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: Number(req.params.id) },
      include: { league: true, homeTeam: true, awayTeam: true, prediction: true },
    });

    if (!fixture) return res.status(404).json({ error: "fixture not found" });

    res.json({
      id: fixture.id,
      apiId: fixture.apiId,
      sport: fixture.sport,
      kickoff: fixture.kickoff,
      status: fixture.status,
      isLive: computeIsLive(fixture),
      clockMinute: fixture.elapsed,
      periodLabel: fixture.periodLabel,
      league: { id: fixture.league.id, name: fixture.league.name, country: fixture.league.country },
      homeTeam: { id: fixture.homeTeam.id, name: fixture.homeTeam.name, logoUrl: fixture.homeTeam.logoUrl },
      awayTeam: { id: fixture.awayTeam.id, name: fixture.awayTeam.name, logoUrl: fixture.awayTeam.logoUrl },
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      prediction: fixture.prediction,
    });
  } catch (err) {
    console.error("[fixture detail] failed:", err);
    res.status(500).json({ error: "failed to load fixture detail" });
  }
});

// ---- Public: live momentum tracker events ----
app.get("/api/fixtures/:id/live-events", async (req, res) => {
  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: Number(req.params.id) },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!fixture) return res.status(404).json({ error: "fixture not found" });
    if (!computeIsLive(fixture)) return res.status(400).json({ error: "fixture is not currently live" });

    const kickoffMinute = Math.min(
      Math.max(Math.round((Date.now() - new Date(fixture.kickoff).getTime()) / 60000), 0),
      120
    );

    // 1. Try ESPN first (Free & Unlimited)
    const espnId = fixture.espnId || fixture.apiId;
    if (fixture.sport === "FOOTBALL" && espnId) {
      const espnData = await espnClient.getMatchSummary(espnId);
      if (espnData.available && espnData.timeline) {
        const diff = (fixture.homeScore ?? 0) - (fixture.awayScore ?? 0);
        return res.json({
          fixtureId: fixture.id,
          clockMinute: kickoffMinute,
          homeTeam: fixture.homeTeam.name,
          awayTeam: fixture.awayTeam.name,
          homeScore: fixture.homeScore,
          awayScore: fixture.awayScore,
          momentum: Math.max(-1, Math.min(1, diff / 3)),
          hasEventFeed: espnData.timeline.length > 0,
          timeline: espnData.timeline.sort((a, b) => a.minute - b.minute),
        });
      }
    }

    // 2. Fallback to API-Sports
    try {
      const client = getClient(fixture.sport);
      const rawEvents = await client.getFixtureEvents(fixture.apiId);
      const { momentum, timeline } = computeMomentum(rawEvents, fixture.apiId, kickoffMinute);

      res.json({
        fixtureId: fixture.id,
        clockMinute: kickoffMinute,
        homeTeam: fixture.homeTeam.name,
        awayTeam: fixture.awayTeam.name,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        momentum,
        hasEventFeed: rawEvents.length > 0 || fixture.sport === "FOOTBALL",
        timeline: timeline.sort((a, b) => a.minute - b.minute),
      });
    } catch (err) {
      console.error("[live-events] provider error:", err.message);
      const diff = (fixture.homeScore ?? 0) - (fixture.awayScore ?? 0);
      res.json({
        fixtureId: fixture.id,
        clockMinute: kickoffMinute,
        homeTeam: fixture.homeTeam.name,
        awayTeam: fixture.awayTeam.name,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        momentum: Math.max(-1, Math.min(1, diff / 3)),
        hasEventFeed: false,
        timeline: [],
      });
    }
  } catch (err) {
    console.error("[live-events] failed:", err);
    res.status(500).json({ error: "failed to load live events" });
  }
});

// ---- Public: live match statistics (possession, shots, corners, cards) ----
app.get("/api/fixtures/:id/stats", async (req, res) => {
  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: Number(req.params.id) },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!fixture) return res.status(404).json({ error: "fixture not found" });

    // 1. Try ESPN first (Free & Unlimited)
    const espnId = fixture.espnId || fixture.apiId;
    if (fixture.sport === "FOOTBALL" && espnId) {
      const espnData = await espnClient.getMatchSummary(espnId);
      if (espnData.available && espnData.stats) {
        return res.json({
          available: true,
          possession: espnData.stats.possession || ["50%", "50%"],
          shotsOnTarget: espnData.stats.shotsOnTarget || [0, 0],
          shotsTotal: espnData.stats.shotsTotal || [0, 0],
          corners: espnData.stats.corners || [0, 0],
          fouls: espnData.stats.fouls || [0, 0],
          yellowCards: [0, 0],
          redCards: [0, 0],
        });
      }
    }

    // 2. Fallback to API-Sports
    if (fixture.provider !== "API_SPORTS" || fixture.sport !== "FOOTBALL") {
      return res.json({ available: false });
    }

    try {
      const client = getClient(fixture.sport);
      const raw = await client.getFixtureStats(fixture.apiId);
      if (!raw || raw.length < 2) return res.json({ available: false });

      let [homeRaw, awayRaw] = raw;
      const byApiId = (id) => raw.find((r) => r.team?.id === id);
      const matchedHome = byApiId(fixture.homeTeam.apiId);
      const matchedAway = byApiId(fixture.awayTeam.apiId);
      if (matchedHome && matchedAway) { homeRaw = matchedHome; awayRaw = matchedAway; }

      const pick = (side, type) => {
        const entry = (side?.statistics || []).find((s) => s.type === type);
        return entry ? entry.value : null;
      };
      const num = (v) => {
        if (v == null) return 0;
        if (typeof v === "string" && v.includes("%")) return parseInt(v, 10) || 0;
        return Number(v) || 0;
      };

      res.json({
        available: true,
        possession: [pick(homeRaw, "Ball Possession") || "50%", pick(awayRaw, "Ball Possession") || "50%"],
        shotsOnTarget: [num(pick(homeRaw, "Shots on Goal")), num(pick(awayRaw, "Shots on Goal"))],
        shotsTotal: [num(pick(homeRaw, "Total Shots")), num(pick(awayRaw, "Total Shots"))],
        corners: [num(pick(homeRaw, "Corner Kicks")), num(pick(awayRaw, "Corner Kicks"))],
        fouls: [num(pick(homeRaw, "Fouls")), num(pick(awayRaw, "Fouls"))],
        yellowCards: [num(pick(homeRaw, "Yellow Cards")), num(pick(awayRaw, "Yellow Cards"))],
        redCards: [num(pick(homeRaw, "Red Cards")), num(pick(awayRaw, "Red Cards"))],
      });
    } catch (err) {
      console.error("[fixture stats] provider error:", err.message);
      res.json({ available: false });
    }
  } catch (err) {
    console.error("[fixture stats] failed:", err);
    res.status(500).json({ error: "failed to load fixture stats" });
  }
});

// ---- Public: starting lineups & formations ----
app.get("/api/fixtures/:id/lineups", async (req, res) => {
  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: Number(req.params.id) },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!fixture) return res.status(404).json({ error: "fixture not found" });

    // 1. Try ESPN first (Free & Unlimited)
    const espnId = fixture.espnId || fixture.apiId;
    if (fixture.sport === "FOOTBALL" && espnId) {
      const espnData = await espnClient.getMatchSummary(espnId);
      if (espnData.available && espnData.lineups && espnData.lineups.length >= 2) {
        const homeSide = espnData.lineups[0];
        const awaySide = espnData.lineups[1];

        const normalizeEspnSide = (side) => ({
          team: side?.team?.displayName,
          formation: side?.formation || "4-3-3",
          startXI: (side?.statistics?.[0]?.athletes || side?.athletes || []).map((a) => ({
            number: a.athlete?.jersey || a.jersey,
            name: a.athlete?.displayName || a.displayName,
            pos: a.position?.abbreviation || a.position,
          })),
        });

        return res.json({
          available: true,
          home: normalizeEspnSide(homeSide),
          away: normalizeEspnSide(awaySide),
        });
      }
    }

    // 2. Fallback to API-Sports
    if (fixture.provider !== "API_SPORTS" || fixture.sport !== "FOOTBALL") {
      return res.json({ available: false });
    }

    try {
      const client = getClient(fixture.sport);
      const raw = await client.getFixtureLineups(fixture.apiId);
      if (!raw || raw.length < 2) return res.json({ available: false });

      const normalizeSide = (side) => ({
        team: side?.team?.name,
        formation: side?.formation,
        startXI: (side?.startXI || []).map((s) => ({
          number: s.player?.number,
          name: s.player?.name,
          pos: s.player?.pos,
        })),
      });

      let [homeRaw, awayRaw] = raw;
      const matchedHome = raw.find((r) => r.team?.id === fixture.homeTeam.apiId);
      const matchedAway = raw.find((r) => r.team?.id === fixture.awayTeam.apiId);
      if (matchedHome && matchedAway) { homeRaw = matchedHome; awayRaw = matchedAway; }

      res.json({ available: true, home: normalizeSide(homeRaw), away: normalizeSide(awayRaw) });
    } catch (err) {
      console.error("[fixture lineups] provider error:", err.message);
      res.json({ available: false });
    }
  } catch (err) {
    console.error("[fixture lineups] failed:", err);
    res.status(500).json({ error: "failed to load fixture lineups" });
  }
});

// ---- Public: site stats win-rate badges ----
app.get("/api/stats/site", async (req, res) => {
  try {
    const stats = await prisma.siteStat.findMany();
    const byKey = Object.fromEntries(stats.map((s) => [s.key, s.value]));
    res.json({
      winRate1x2: byKey.win_rate_1x2 ?? null,
      winRateBtts: byKey.win_rate_btts ?? null,
      totalSettled: byKey.total_settled ?? 0,
    });
  } catch (err) {
    console.error("[site stats] failed:", err);
    res.status(500).json({ error: "failed to load site stats" });
  }
});

// ---- Public: rolling prediction accuracy / track record ----
// ?days=30 (default) — windowed on settlement date, see predictionTrackRecord.js
app.get("/api/stats/accuracy", async (req, res) => {
  try {
    const report = await getAccuracyReport(req.query.days);
    res.json(report);
  } catch (err) {
    console.error("[accuracy report] failed:", err);
    res.status(500).json({ error: "failed to load accuracy report" });
  }
});

// ---- Public: Best Bet of the Day (+ 2 runners-up) ----
app.get("/api/predictions/best-bet", async (req, res) => {
  try {
    const result = await getBestBet();
    res.json(result);
  } catch (err) {
    console.error("[best bet] failed:", err);
    res.status(500).json({ error: "failed to load best bet" });
  }
});

// ---- Public: news headlines ----
app.get("/api/news", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 24, 60);
    const sportParam = req.query.sport ? String(req.query.sport).toUpperCase() : "ALL";
    if (sportParam !== "ALL" && !SPORTS[sportParam]) {
      return res.status(400).json({ error: `unknown sport: ${sportParam}` });
    }
    const articles = await prisma.newsArticle.findMany({
      where: sportParam === "ALL" ? {} : { sport: sportParam },
      orderBy: { publishedAt: "desc" },
      take: limit,
    });
    res.json(articles);
  } catch (err) {
    console.error("[news] failed:", err);
    res.status(500).json({ error: "failed to load news" });
  }
});

// ---- Public: enabled sports list ----
app.get("/api/sports", (req, res) => {
  res.json(enabledSports());
});

// ---- Public: global search ----
app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ teams: [], leagues: [], fixtures: [], news: [], players: [] });

    const [teams, leagues, news, players] = await Promise.all([
      prisma.team.findMany({ where: { name: { contains: q } }, take: 8 }),
      prisma.league.findMany({ where: { name: { contains: q } }, take: 6 }),
      prisma.newsArticle.findMany({ where: { title: { contains: q } }, take: 6, orderBy: { publishedAt: "desc" } }),
      prisma.fplPlayer.findMany({
        where: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }] },
        take: 6,
        orderBy: { totalPoints: "desc" },
      }),
    ]);

    const teamIds = teams.map((t) => t.id);
    const fixtures = await prisma.fixture.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE"] },
        OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      },
      orderBy: { kickoff: "asc" },
      take: 10,
      include: { homeTeam: true, awayTeam: true, league: true },
    });

    res.json({
      teams: teams.map((t) => ({ id: t.id, name: t.name, sport: t.sport, logoUrl: t.logoUrl })),
      leagues: leagues.map((l) => ({ id: l.id, name: l.name, sport: l.sport, country: l.country })),
      fixtures: fixtures.map((f) => ({
        id: f.id,
        kickoff: f.kickoff,
        homeTeam: f.homeTeam.name,
        awayTeam: f.awayTeam.name,
        league: f.league.name,
      })),
      news: news.map((n) => ({ id: n.id, title: n.title, url: n.url, source: n.source })),
    });
  } catch (err) {
    console.error("[search] failed:", err);
    res.status(500).json({ error: "failed to perform search" });
  }
});

// ---- Public: Match Insights ----
app.get("/api/fixtures/:id/insights", async (req, res) => {
  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: Number(req.params.id) },
      include: { homeTeam: true, awayTeam: true, prediction: true },
    });
    if (!fixture) return res.status(404).json({ error: "fixture not found" });

    await ensureH2hData(fixture);

    const [homeForm, awayForm, h2h, homeFormResults, awayFormResults] = await Promise.all([
      predictionEngine.getTeamForm(fixture.homeTeamId, fixture.kickoff),
      predictionEngine.getTeamForm(fixture.awayTeamId, fixture.kickoff),
      prisma.fixture.findMany({
        where: {
          status: "FINISHED",
          OR: [
            { homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId },
            { homeTeamId: fixture.awayTeamId, awayTeamId: fixture.homeTeamId },
          ],
        },
        orderBy: { kickoff: "desc" },
        take: 10,
        select: { kickoff: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true, league: { select: { name: true } } },
      }),
      recentFormBadges(fixture.homeTeamId, fixture.kickoff),
      recentFormBadges(fixture.awayTeamId, fixture.kickoff),
    ]);

    const h2hSummary = h2h.reduce(
      (acc, m) => {
        const homeWasFixtureHome = m.homeTeamId === fixture.homeTeamId;
        const homeScore = homeWasFixtureHome ? m.homeScore : m.awayScore;
        const awayScore = homeWasFixtureHome ? m.awayScore : m.homeScore;
        if (homeScore > awayScore) acc.homeWins += 1;
        else if (homeScore < awayScore) acc.awayWins += 1;
        else acc.draws += 1;
        return acc;
      },
      { homeWins: 0, draws: 0, awayWins: 0 }
    );

    res.json({
      homeTeam: fixture.homeTeam.name,
      awayTeam: fixture.awayTeam.name,
      form: {
        home: { avgScored: round1(homeForm.avgScored), avgConceded: round1(homeForm.avgConceded), sampleSize: homeForm.sampleSize, recent: homeFormResults },
        away: { avgScored: round1(awayForm.avgScored), avgConceded: round1(awayForm.avgConceded), sampleSize: awayForm.sampleSize, recent: awayFormResults },
      },
      h2h: {
        meetings: h2h.length,
        ...h2hSummary,
        recent: h2h.slice(0, 5).map((m) => ({
          kickoff: m.kickoff,
          competition: m.league.name,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
        })),
      },
      prediction: fixture.prediction,
    });
  } catch (err) {
    console.error("[insights] failed:", err);
    res.status(500).json({ error: "failed to load match insights" });
  }
});

/** Last 5 finished results for a team (any competition), as W/D/L badges, most recent first. */
async function recentFormBadges(teamId, beforeDate) {
  const matches = await prisma.fixture.findMany({
    where: { status: "FINISHED", kickoff: { lt: beforeDate }, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    orderBy: { kickoff: "desc" },
    take: 5,
    select: { homeTeamId: true, homeScore: true, awayScore: true },
  });
  return matches.map((m) => {
    const isHome = m.homeTeamId === teamId;
    const own = isHome ? m.homeScore : m.awayScore;
    const opp = isHome ? m.awayScore : m.homeScore;
    if (own > opp) return "W";
    if (own < opp) return "L";
    return "D";
  });
}

function round1(n) { return Math.round(n * 10) / 10; }

// ---- Public: FPL Squad recommendation ----
app.get("/api/fpl/squad", async (req, res) => {
  try {
    const gw = req.query.gameweek ? Number(req.query.gameweek) : await currentGameweek();
    let record = await prisma.fplSquadRecommendation.findUnique({ where: { gameweek: gw } });
    // Only auto-generate on the fly for the actual current gameweek — an
    // explicit ?gameweek= for a past/future week that has no stored
    // record should 404, not silently generate a brand-new recommendation
    // under a gameweek number it wasn't asked to create.
    if (!record && !req.query.gameweek) record = await generateSquadRecommendation(gw);
    if (!record) return res.status(404).json({ error: `no squad recommendation stored for GW${gw}` });

    const meta = await prisma.fplGameweek.findUnique({ where: { id: gw } });
    res.json({ ...record, deadlineTime: meta?.deadlineTime ?? null, isCurrent: meta?.isCurrent ?? false, finished: meta?.finished ?? false });
  } catch (err) {
    console.error("[fpl squad] failed:", err);
    res.status(503).json({ error: "FPL data not ready yet — has fplSync run?" });
  }
});

// ---- Public: list gameweeks that have a stored squad recommendation,
// with deadline/current/finished metadata — powers the clickable
// gameweek tabs on the FPL Scout tab.
app.get("/api/fpl/gameweeks", async (req, res) => {
  try {
    const [recommendations, gameweekMeta] = await Promise.all([
      prisma.fplSquadRecommendation.findMany({
        select: { gameweek: true, totalPointsEarned: true },
        orderBy: { gameweek: "desc" },
      }),
      prisma.fplGameweek.findMany(),
    ]);

    const metaById = new Map(gameweekMeta.map((g) => [g.id, g]));

    res.json(
      recommendations.map((r) => {
        const meta = metaById.get(r.gameweek);
        return {
          gameweek: r.gameweek,
          totalPointsEarned: r.totalPointsEarned,
          deadlineTime: meta?.deadlineTime ?? null,
          isCurrent: meta?.isCurrent ?? false,
          finished: meta?.finished ?? false,
        };
      })
    );
  } catch (err) {
    console.error("[fpl gameweeks] failed:", err);
    res.status(500).json({ error: "failed to load gameweek list" });
  }
});

// ---- Public: FPL Players browser ----
app.get("/api/fpl/players", async (req, res) => {
  try {
    const { search, position } = req.query;
    const players = await prisma.fplPlayer.findMany({
      where: {
        ...(search ? { OR: [{ firstName: { contains: String(search) } }, { lastName: { contains: String(search) } }] } : {}),
        ...(position ? { position: String(position).toUpperCase() } : {}),
      },
      orderBy: { totalPoints: "desc" },
      take: 50,
    });
    res.json(players);
  } catch (err) {
    console.error("[fpl players] failed:", err);
    res.status(500).json({ error: "failed to load FPL players" });
  }
});

// ---- Public: full team profile (info, history, upcoming, standings, squad) ----
app.get("/api/teams/:id/profile", async (req, res) => {
  try {
    const profile = await getTeamProfile(Number(req.params.id));
    if (!profile) return res.status(404).json({ error: "team not found" });
    res.json(profile);
  } catch (err) {
    console.error("[team profile] failed:", err);
    res.status(500).json({ error: "failed to load team profile" });
  }
});

// ---- Live score stream (SSE) ----
app.get("/api/live/stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 5000\n\n");

  const sendLiveFixtures = async () => {
    try {
      const live = await prisma.fixture.findMany({
        where: { status: { in: ["LIVE", "HALFTIME"] } },
        include: { homeTeam: true, awayTeam: true, league: true },
      });
      const payload = live.map((f) => ({
        id: f.id,
        sport: f.sport,
        status: f.status,
        league: f.league.name,
        homeTeam: f.homeTeam.name,
        awayTeam: f.awayTeam.name,
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        clockMinute: f.elapsed,
        periodLabel: f.periodLabel,
      }));
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      console.error("[live stream] failed to read DB:", err.message);
    }
  };

  await sendLiveFixtures();
  const interval = setInterval(sendLiveFixtures, 10000);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);

  // The scheduler (src/cron/scheduler.js) is its own npm script
  // (`npm run cron:start`) deliberately — on a host that can run two
  // long-lived processes (e.g. a web dyno + a worker dyno), keeping sync
  // cadence out of the request-serving process is the safer default. But
  // that's easy to forget to actually start, and on simpler hosting
  // (a single Node app, e.g. cPanel/CloudLinux "Node.js Selector") running
  // two persistent processes isn't always convenient — so this flag lets
  // ONE `npm run server:start` do both. Off by default so existing
  // two-process deployments aren't double-scheduled.
  if (process.env.RUN_SCHEDULER_IN_PROCESS === "true") {
    const { startScheduler } = require("./cron/scheduler");
    startScheduler();
  }
});

module.exports = app;