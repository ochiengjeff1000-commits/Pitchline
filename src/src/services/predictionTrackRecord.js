const prisma = require("../lib/prisma");
const predictionEngine = require("./predictionEngine");

// Simple in-memory TTL cache — this is a public, potentially high-traffic
// page (it's the trust/proof page, so it's meant to be linked from
// marketing and checked often) computed from a findMany + in-memory
// grouping rather than a precomputed table like siteStats.js. Cheap
// enough at current data volume to compute on demand, but no reason to
// recompute it on every single request when settlementJob only produces
// new results every few hours.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cached(key, ttlMs, compute) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = compute();
  cache.set(key, { value, at: Date.now() });
  return value;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Confidence tiers — mirrors the cap predictionEngine.js applies when
// sampleSize < MIN_SAMPLE_SIZE (0.45), so "Low" here roughly lines up
// with "the model wasn't sure and said so" rather than an arbitrary cut.
const CONFIDENCE_TIERS = [
  { key: "HIGH", label: "High confidence (60%+)", min: 0.6, max: 1.01 },
  { key: "MEDIUM", label: "Medium confidence (45–60%)", min: 0.45, max: 0.6 },
  { key: "LOW", label: "Low confidence (<45%)", min: 0, max: 0.45 },
];

/**
 * Rolling accuracy / track-record report — the public proof-of-performance
 * page. Windowed on `settledAt` (when settlementJob actually graded the
 * leg), not `kickoff`, so "last 30 days" means "30 days of graded
 * results", consistent regardless of how far in advance predictions were
 * generated.
 */
async function getAccuracyReport(days = 30) {
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);

  return cached(`accuracy:${windowDays}`, CACHE_TTL_MS, async () => {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [settled, allTimeStats] = await Promise.all([
      prisma.prediction.findMany({
        where: { isCorrect: { not: null }, settledAt: { gte: since } },
        select: {
          isCorrect: true,
          bttsCorrect: true,
          confidence: true,
          predictedOutcome: true,
          actualOutcome: true,
          settledAt: true,
          fixture: {
            select: {
              id: true,
              kickoff: true,
              homeScore: true,
              awayScore: true,
              homeTeam: { select: { name: true } },
              awayTeam: { select: { name: true } },
              league: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { settledAt: "desc" },
      }),
      prisma.siteStat.findMany(),
    ]);

    const totalSettled = settled.length;
    const correct1x2 = settled.filter((p) => p.isCorrect).length;
    const bttsSettled = settled.filter((p) => p.bttsCorrect !== null);
    const correctBtts = bttsSettled.filter((p) => p.bttsCorrect).length;

    const byConfidence = CONFIDENCE_TIERS.map((tier) => {
      const inTier = settled.filter((p) => p.confidence >= tier.min && p.confidence < tier.max);
      const correct = inTier.filter((p) => p.isCorrect).length;
      return {
        tier: tier.key,
        label: tier.label,
        totalSettled: inTier.length,
        correct,
        winRate: inTier.length ? round1((correct / inTier.length) * 100) : null,
      };
    });

    const leagueMap = new Map();
    for (const p of settled) {
      const league = p.fixture.league;
      if (!leagueMap.has(league.id)) leagueMap.set(league.id, { leagueId: league.id, leagueName: league.name, totalSettled: 0, correct: 0 });
      const entry = leagueMap.get(league.id);
      entry.totalSettled += 1;
      if (p.isCorrect) entry.correct += 1;
    }
    const byLeague = [...leagueMap.values()]
      .filter((l) => l.totalSettled >= 5) // hide noisy small samples
      .map((l) => ({ ...l, winRate: round1((l.correct / l.totalSettled) * 100) }))
      .sort((a, b) => b.totalSettled - a.totalSettled)
      .slice(0, 8);

    const recentTips = settled.slice(0, 20).map((p) => ({
      fixtureId: p.fixture.id,
      league: p.fixture.league.name,
      homeTeam: p.fixture.homeTeam.name,
      awayTeam: p.fixture.awayTeam.name,
      kickoff: p.fixture.kickoff,
      finalScore: p.fixture.homeScore != null ? `${p.fixture.homeScore}-${p.fixture.awayScore}` : null,
      predictedOutcome: p.predictedOutcome,
      actualOutcome: p.actualOutcome,
      confidence: p.confidence,
      isCorrect: p.isCorrect,
      settledAt: p.settledAt,
    }));

    const byKey = Object.fromEntries(allTimeStats.map((s) => [s.key, s.value]));

    return {
      windowDays,
      window: {
        totalSettled,
        correct1x2,
        winRate1x2: totalSettled ? round1((correct1x2 / totalSettled) * 100) : null,
        totalBttsSettled: bttsSettled.length,
        correctBtts,
        winRateBtts: bttsSettled.length ? round1((correctBtts / bttsSettled.length) * 100) : null,
      },
      allTime: {
        winRate1x2: byKey.win_rate_1x2 ?? null,
        winRateBtts: byKey.win_rate_btts ?? null,
        totalSettled: byKey.total_settled ?? 0,
      },
      byConfidence,
      byLeague,
      recentTips,
    };
  });
}

// How far ahead to look for "today's" best bet — wide enough that the
// feature always has something to show regardless of what time of day
// it's requested, without reaching so far ahead it stops meaning "today".
const BEST_BET_WINDOW_HOURS = 30;

/**
 * Best Bet of the Day — the single highest-confidence prediction across
 * every league/sport for fixtures kicking off soon, plus two runners-up.
 * Deliberately excludes:
 *  - anything below MIN_SAMPLE_SIZE-backed confidence (predictionEngine
 *    already caps low-sample confidence at 0.45, but this is an explicit
 *    floor so a thin-data fluke can never headline the homepage)
 *  - JACKPOT_MANUAL placeholder fixtures (auto-created by jackpotIngestion
 *    for legs with no real fixture yet — see jackpotIngestion.js) since
 *    they may not have a real kickoff time or confirmed team names
 */
async function getBestBet() {
  return cached("best-bet", CACHE_TTL_MS, async () => {
    const now = new Date();
    const until = new Date(now.getTime() + BEST_BET_WINDOW_HOURS * 60 * 60 * 1000);

    const candidates = await prisma.prediction.findMany({
      where: {
        confidence: { gte: 0.5 },
        sampleSize: { gte: predictionEngine.MIN_SAMPLE_SIZE },
        fixture: {
          status: "SCHEDULED",
          kickoff: { gte: now, lte: until },
          provider: { not: "JACKPOT_MANUAL" },
        },
      },
      orderBy: { confidence: "desc" },
      take: 3,
      include: {
        fixture: {
          include: {
            homeTeam: { select: { name: true, logoUrl: true } },
            awayTeam: { select: { name: true, logoUrl: true } },
            league: { select: { name: true, country: true } },
          },
        },
      },
    });

    const shape = (p) => ({
      fixtureId: p.fixture.id,
      sport: p.fixture.sport,
      league: p.fixture.league.name,
      country: p.fixture.league.country,
      kickoff: p.fixture.kickoff,
      homeTeam: p.fixture.homeTeam.name,
      homeLogo: p.fixture.homeTeam.logoUrl,
      awayTeam: p.fixture.awayTeam.name,
      awayLogo: p.fixture.awayTeam.logoUrl,
      predictedOutcome: p.predictedOutcome,
      confidence: p.confidence,
      predictedScore: p.predictedHomeGoals != null ? { home: p.predictedHomeGoals, away: p.predictedAwayGoals } : null,
      justification: p.justification,
    });

    if (candidates.length === 0) return { bestBet: null, alternates: [] };
    const [top, ...rest] = candidates;
    return { bestBet: shape(top), alternates: rest.map(shape) };
  });
}

module.exports = { getAccuracyReport, getBestBet };
