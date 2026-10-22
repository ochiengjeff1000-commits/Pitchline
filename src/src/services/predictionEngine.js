const prisma = require("../lib/prisma");

// "Weighted 5-Match Recent Form": only the last 5 finished games count,
// and the most recent ones count more (recency-weighted average) rather
// than every game in the window being treated equally.
const FORM_WINDOW = 5;
const RECENCY_WEIGHTS = [5, 4, 3, 2, 1]; // most-recent-first

// How many past head-to-head meetings to weigh in.
const H2H_WINDOW = 5;
// How much the H2H signal nudges the final 1X2 probabilities (0..1).
const H2H_WEIGHT = 0.12;

// Home advantage multiplier applied to the home side's expected goals.
const HOME_ADVANTAGE = 1.1;

// Minimum finished matches we need on file before we trust a prediction
// enough to publish it. Below this, confidence is capped low and the
// justification says so explicitly.
const MIN_SAMPLE_SIZE = 4;

// League-average goals per team per match, used as a fallback prior when
// a team (or league) has little or no history yet (early in the DB's
// life) — see getLeagueAverageGoals for the dynamic, per-league version.
const LEAGUE_AVG_GOALS = 1.35;

// Minimum finished league fixtures required before we trust a league's
// OWN computed goal average over the global LEAGUE_AVG_GOALS fallback.
const MIN_LEAGUE_SAMPLE_FOR_DYNAMIC_AVG = 10;

// Rest-days fatigue penalty: a team that played within this many days of
// the fixture gets its expected goals (lambda) knocked down by
// FATIGUE_FACTOR to reflect squad rotation / physical exhaustion from
// fixture congestion.
const FATIGUE_THRESHOLD_DAYS = 3;
const FATIGUE_FACTOR = 0.92;

// Floor applied to lambdaHome/lambdaAway after all multiplicative
// adjustments (attack/defense ratios, home advantage, fatigue) so a very
// weak attack vs. a very strong defense can't collapse expected goals to
// ~0 and destabilize the Poisson grid.
const MIN_LAMBDA = 0.05;

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Dixon-Coles low-score correlation adjustment (tau). Standard football
// scorelines (0-0, 1-0, 0-1, 1-1) are slightly under/over-represented by
// a naive independent-Poisson model, so this nudges them.
function dixonColesTau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

/**
 * Turns a list of {kickoff, scored, conceded} games (already sorted
 * most-recent-first and capped at FORM_WINDOW) into a recency-weighted
 * average — game 0 (most recent) counts for more than game 4, per
 * RECENCY_WEIGHTS. Returns null for an empty list so callers can decide
 * their own fallback instead of silently getting a fabricated average.
 */
function weightedFormFromGames(games) {
  const sampleSize = games.length;
  if (sampleSize === 0) return null;

  let weightedScored = 0;
  let weightedConceded = 0;
  let weightTotal = 0;
  games.forEach((g, i) => {
    const w = RECENCY_WEIGHTS[i] ?? 1;
    weightedScored += g.scored * w;
    weightedConceded += g.conceded * w;
    weightTotal += w;
  });

  return {
    avgScored: weightedScored / weightTotal,
    avgConceded: weightedConceded / weightTotal,
    sampleSize,
  };
}

/**
 * Pulls the team's last FORM_WINDOW finished matches and returns a
 * recency-weighted average of goals scored/conceded. Sport-agnostic —
 * works on any goals/points scoring system, since it just reads
 * homeScore/awayScore.
 *
 * UPGRADE 1 — Home/Away split form: pass venueFilter = "HOME" to get
 * form computed strictly from the team's last 5 finished HOME matches
 * (used when evaluating that team as the home side), or "AWAY" for
 * strictly its last 5 finished AWAY matches (used when evaluating it as
 * the away side). If the local-venue sample is empty (a team with zero
 * home or zero away matches on file yet), this falls back to the pooled
 * home+away list rather than returning an empty/fabricated form. Calling
 * without a venueFilter (existing behavior, used by
 * generateThreeWayPrediction/generateTwoWayPrediction) still returns the
 * original pooled home+away form — fully backward compatible.
 *
 * @param {number} teamId
 * @param {Date} beforeDate
 * @param {"HOME"|"AWAY"} [venueFilter]
 */
async function getTeamForm(teamId, beforeDate, venueFilter) {
  const [asHomeRaw, asAwayRaw] = await Promise.all([
    prisma.fixture.findMany({
      where: { homeTeamId: teamId, status: "FINISHED", kickoff: { lt: beforeDate } },
      orderBy: { kickoff: "desc" },
      take: FORM_WINDOW,
      select: { kickoff: true, homeScore: true, awayScore: true },
    }),
    prisma.fixture.findMany({
      where: { awayTeamId: teamId, status: "FINISHED", kickoff: { lt: beforeDate } },
      orderBy: { kickoff: "desc" },
      take: FORM_WINDOW,
      select: { kickoff: true, homeScore: true, awayScore: true },
    }),
  ]);

  const homeGames = asHomeRaw.map((f) => ({ kickoff: f.kickoff, scored: f.homeScore ?? 0, conceded: f.awayScore ?? 0 }));
  const awayGames = asAwayRaw.map((f) => ({ kickoff: f.kickoff, scored: f.awayScore ?? 0, conceded: f.homeScore ?? 0 }));

  const pooledGames = [...homeGames, ...awayGames]
    .sort((a, b) => b.kickoff - a.kickoff)
    .slice(0, FORM_WINDOW);

  let selectedGames;
  if (venueFilter === "HOME") {
    selectedGames = homeGames.length > 0 ? homeGames : pooledGames; // fall back to pooled only if 0 home games on file
  } else if (venueFilter === "AWAY") {
    selectedGames = awayGames.length > 0 ? awayGames : pooledGames; // fall back to pooled only if 0 away games on file
  } else {
    selectedGames = pooledGames;
  }

  const form = weightedFormFromGames(selectedGames);
  if (!form) return { avgScored: LEAGUE_AVG_GOALS, avgConceded: LEAGUE_AVG_GOALS, sampleSize: 0 };
  return form;
}

/**
 * UPGRADE 2 — Dynamic, league-specific goal average, replacing the
 * hardcoded global LEAGUE_AVG_GOALS (1.35) as the anchor for the
 * attack/defense strength ratings below. Computes the actual mean goals
 * scored per team per match across every finished fixture on file for
 * this league (i.e. total goals across all finished matches, divided by
 * matches * 2 sides). Falls back to the global LEAGUE_AVG_GOALS constant
 * if the league has fewer than MIN_LEAGUE_SAMPLE_FOR_DYNAMIC_AVG finished
 * fixtures in the DB — too small a sample to trust over the global prior.
 *
 * @param {number} leagueId
 * @param {Date} beforeDate
 */
async function getLeagueAverageGoals(leagueId, beforeDate) {
  if (!leagueId) return LEAGUE_AVG_GOALS;

  const matches = await prisma.fixture.findMany({
    where: { leagueId, status: "FINISHED", kickoff: { lt: beforeDate } },
    select: { homeScore: true, awayScore: true },
  });

  if (matches.length < MIN_LEAGUE_SAMPLE_FOR_DYNAMIC_AVG) return LEAGUE_AVG_GOALS;

  const totalGoals = matches.reduce((sum, m) => sum + (m.homeScore ?? 0) + (m.awayScore ?? 0), 0);
  return totalGoals / (matches.length * 2);
}

/**
 * UPGRADE 4 — Fixture congestion / rest-days signal. Finds the kickoff
 * timestamp of the team's most recent finished match (any venue) and
 * returns how many days ago that was relative to `beforeDate` (typically
 * the upcoming fixture's own kickoff). Returns null if the team has no
 * prior finished match on file — callers should treat that as "no
 * fatigue penalty", not as 0 days rest.
 *
 * @param {number} teamId
 * @param {Date} beforeDate
 */
async function getRestDays(teamId, beforeDate) {
  const lastMatch = await prisma.fixture.findFirst({
    where: {
      status: "FINISHED",
      kickoff: { lt: beforeDate },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    orderBy: { kickoff: "desc" },
    select: { kickoff: true },
  });

  if (!lastMatch) return null;
  return (beforeDate.getTime() - lastMatch.kickoff.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Pulls the last H2H_WINDOW finished meetings between these two teams
 * (in either home/away configuration) and returns a simple outcome
 * distribution from fixture.homeTeamId's perspective for THIS fixture
 * (i.e. re-oriented so "home" always means the current fixture's home team).
 */
async function getH2hSignal(homeTeamId, awayTeamId, beforeDate) {
  const meetings = await prisma.fixture.findMany({
    where: {
      status: "FINISHED",
      kickoff: { lt: beforeDate },
      OR: [
        { homeTeamId, awayTeamId },
        { homeTeamId: awayTeamId, awayTeamId: homeTeamId },
      ],
    },
    orderBy: { kickoff: "desc" },
    take: H2H_WINDOW,
    select: { homeTeamId: true, homeScore: true, awayScore: true },
  });

  if (meetings.length === 0) return { homeWinRate: null, drawRate: null, awayWinRate: null, sampleSize: 0 };

  let homeWins = 0, draws = 0, awayWins = 0;
  for (const m of meetings) {
    const fixtureHomeWasMeetingHome = m.homeTeamId === homeTeamId;
    const home = fixtureHomeWasMeetingHome ? m.homeScore : m.awayScore;
    const away = fixtureHomeWasMeetingHome ? m.awayScore : m.homeScore;
    if (home > away) homeWins += 1;
    else if (home < away) awayWins += 1;
    else draws += 1;
  }

  const n = meetings.length;
  return { homeWinRate: homeWins / n, drawRate: draws / n, awayWinRate: awayWins / n, sampleSize: n };
}

/**
 * Converts bookmaker decimal odds into de-vigged (overround-removed)
 * implied probabilities. Purely a math helper — never calls an API;
 * odds must be supplied by the caller (e.g. entered manually by an
 * admin, or pulled once a week for Tier 1 fixtures only — see README).
 */
function impliedProbsFromOdds({ home, draw, away }) {
  const rawHome = 1 / home;
  const rawDraw = draw ? 1 / draw : 0;
  const rawAway = 1 / away;
  const overround = rawHome + rawDraw + rawAway;
  return { home: rawHome / overround, draw: rawDraw / overround, away: rawAway / overround };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

const EMPTY_EXPANDED_MARKETS = {
  over15Prob: null, under15Prob: null,
  over35Prob: null, under35Prob: null,
  doubleChance1XProb: null, doubleChance12Prob: null, doubleChanceX2Prob: null,
  dnbHomeProb: null, dnbAwayProb: null,
  cleanSheetHomeProb: null, cleanSheetAwayProb: null,
  oddTotalProb: null, evenTotalProb: null,
  correctScoreTop3: null,
};

/**
 * FOOTBALL ONLY. Generates 1X2 + the full expanded market set for a
 * fixture, combining:
 *  - a Poisson goal-expectancy matrix (Dixon-Coles low-score adjusted,
 *    with a league-adjusted rho — UPGRADE 5)
 *  - home/away-split, recency-weighted recent form (UPGRADE 1)
 *  - true relative attack/defense strength ratings anchored to a
 *    dynamic, per-league goal average instead of a hardcoded global
 *    constant (UPGRADES 2 & 3)
 *  - a fixture-congestion / rest-days fatigue penalty (UPGRADE 4)
 *  - head-to-head history (blended in as a probability nudge)
 *  - a home-advantage multiplier on expected goals
 * Every extra market below (double chance, DNB, multi-line O/U, clean
 * sheets, correct score, odd/even) is read straight off the SAME matrix
 * used for 1X2 — no extra computation pass, no extra API calls (reads
 * only fixtures already in our own database).
 *
 * Only use this for football/soccer — the Poisson goal model is
 * calibrated around ~1.35 goals/team/match by default (dynamically
 * recalculated per-league once enough data exists — see
 * getLeagueAverageGoals). Feeding it a sport with a completely different
 * scoring scale (e.g. handball's ~25+ goals/team) would produce
 * meaningless output; see generateThreeWayPrediction and
 * generateTwoWayPrediction for those instead.
 *
 * @param {object} fixture
 * @param {object} [options]
 * @param {{home:number, draw:number, away:number}} [options.marketOdds] -
 *   optional decimal odds to blend in as a confidence calibrator. Never
 *   fetched automatically (that would cost API calls) — only used if the
 *   caller already has them on hand.
 * @param {number} [options.marketWeight=0.4] - 0..1, how much weight the
 *   market gets vs. the model when odds are supplied.
 * @param {number} [options.rho] - override the Dixon-Coles low-score
 *   correlation parameter. Defaults to a league-adjusted value: -0.06
 *   for low-scoring leagues, -0.04 for high-scoring leagues (see
 *   UPGRADE 5 below), rather than a single hardcoded -0.05 for every
 *   league.
 */
async function generatePrediction(fixture, options = {}) {
  const [homeForm, awayForm, h2h, leagueAvgGoals, homeRestDays, awayRestDays] = await Promise.all([
    getTeamForm(fixture.homeTeamId, fixture.kickoff, "HOME"),
    getTeamForm(fixture.awayTeamId, fixture.kickoff, "AWAY"),
    getH2hSignal(fixture.homeTeamId, fixture.awayTeamId, fixture.kickoff),
    getLeagueAverageGoals(fixture.leagueId, fixture.kickoff),
    getRestDays(fixture.homeTeamId, fixture.kickoff),
    getRestDays(fixture.awayTeamId, fixture.kickoff),
  ]);

  // UPGRADE 3 — True relative attack/defense strength ratings (classic
  // Poisson attack/defense formulation), each expressed relative to the
  // league's own average goals rather than a flat pooled average of the
  // two sides' raw scoring rates:
  //   Home Attack Strength   = Home team's HOME scored avg / League avg
  //   Away Defense Weakness  = Away team's AWAY conceded avg / League avg
  //   Away Attack Strength   = Away team's AWAY scored avg / League avg
  //   Home Defense Weakness  = Home team's HOME conceded avg / League avg
  // A strength > 1 means "better than league average at this", < 1 means
  // "worse". Multiplying a team's attack strength by the opponent's
  // defense weakness (then rescaling by the league average) gives the
  // classic Dixon-Coles-style expected-goals estimate.
  const homeAttackStrength = homeForm.avgScored / leagueAvgGoals;
  const awayDefenseWeakness = awayForm.avgConceded / leagueAvgGoals;
  const awayAttackStrength = awayForm.avgScored / leagueAvgGoals;
  const homeDefenseWeakness = homeForm.avgConceded / leagueAvgGoals;

  let lambdaHome = homeAttackStrength * awayDefenseWeakness * leagueAvgGoals * HOME_ADVANTAGE;
  let lambdaAway = awayAttackStrength * homeDefenseWeakness * leagueAvgGoals;

  // UPGRADE 4 — Fixture congestion / rest-days fatigue penalty: a side
  // that played within FATIGUE_THRESHOLD_DAYS of this kickoff gets its
  // expected goals knocked down by FATIGUE_FACTOR (squad rotation /
  // physical exhaustion). Applied independently per side.
  const fatigueApplied = { home: false, away: false };
  if (homeRestDays != null && homeRestDays < FATIGUE_THRESHOLD_DAYS) {
    lambdaHome *= FATIGUE_FACTOR;
    fatigueApplied.home = true;
  }
  if (awayRestDays != null && awayRestDays < FATIGUE_THRESHOLD_DAYS) {
    lambdaAway *= FATIGUE_FACTOR;
    fatigueApplied.away = true;
  }

  // Floor lambdas — after chaining several multiplicative adjustments
  // (attack/defense ratios, home advantage, fatigue), a very weak attack
  // against a very strong defense could otherwise collapse toward 0 and
  // destabilize poissonPmf/the correct-score grid.
  lambdaHome = Math.max(lambdaHome, MIN_LAMBDA);
  lambdaAway = Math.max(lambdaAway, MIN_LAMBDA);

  // UPGRADE 5 — League-adjusted Dixon-Coles rho. Instead of a single
  // hardcoded -0.05 for every league, default to -0.06 (stronger
  // low-score correlation correction) for leagues that average at or
  // below the league-average-goals baseline, and -0.04 for
  // higher-scoring leagues where extreme low scorelines are relatively
  // rarer. Callers can still override entirely via options.rho.
  const rho = options.rho ?? (leagueAvgGoals <= LEAGUE_AVG_GOALS ? -0.06 : -0.04);
  const maxGoals = 8;

  let pHome = 0, pDraw = 0, pAway = 0;
  let pBttsYes = 0;
  let p15 = 0, p25 = 0, p35 = 0; // over-N sums
  let cleanSheetHomeSum = 0, cleanSheetAwaySum = 0; // P(away=0), P(home=0)
  let oddSum = 0;

  const cells = []; // every {h, a, p} — used for the correct-score top 3

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const base = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      const tau = dixonColesTau(h, a, lambdaHome, lambdaAway, rho);
      const p = Math.max(base * tau, 0);
      cells.push({ h, a, p });

      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;

      if (h > 0 && a > 0) pBttsYes += p;
      const total = h + a;
      if (total > 1) p15 += p;
      if (total > 2) p25 += p;
      if (total > 3) p35 += p;
      if (a === 0) cleanSheetHomeSum += p;
      if (h === 0) cleanSheetAwaySum += p;
      if (total % 2 === 1) oddSum += p;
    }
  }

  // Normalize (the truncated grid + tau adjustment can drift slightly off 1).
  const total = pHome + pDraw + pAway;
  pHome /= total; pDraw /= total; pAway /= total;
  pBttsYes = Math.min(pBttsYes / total, 1);
  p15 = Math.min(p15 / total, 1);
  p25 = Math.min(p25 / total, 1);
  p35 = Math.min(p35 / total, 1);
  const cleanSheetHome = Math.min(cleanSheetHomeSum / total, 1);
  const cleanSheetAway = Math.min(cleanSheetAwaySum / total, 1);
  const oddTotal = Math.min(oddSum / total, 1);

  // Blend in head-to-head history as a light nudge — real signal (this
  // fixture pair specifically), but recent-form + the Poisson model stay
  // the primary driver, so the H2H weight is kept modest and scaled down
  // further when there's only a thin H2H sample.
  if (h2h.sampleSize > 0) {
    const h2hConfidence = Math.min(h2h.sampleSize / H2H_WINDOW, 1);
    const w = H2H_WEIGHT * h2hConfidence;
    pHome = pHome * (1 - w) + h2h.homeWinRate * w;
    pDraw = pDraw * (1 - w) + h2h.drawRate * w;
    pAway = pAway * (1 - w) + h2h.awayWinRate * w;
    const renorm = pHome + pDraw + pAway;
    pHome /= renorm; pDraw /= renorm; pAway /= renorm;
  }

  if (options.marketOdds) {
    const market = impliedProbsFromOdds(options.marketOdds);
    const w = options.marketWeight ?? 0.4;
    pHome = pHome * (1 - w) + market.home * w;
    pDraw = pDraw * (1 - w) + market.draw * w;
    pAway = pAway * (1 - w) + market.away * w;
    const renorm = pHome + pDraw + pAway;
    pHome /= renorm; pDraw /= renorm; pAway /= renorm;
  }
  // NOTE: the market/H2H blend above only touches 1X2 — the expanded
  // markets below (O/U, BTTS, clean sheets, correct score) are read
  // straight off the unblended Poisson matrix. Keeping them
  // matrix-consistent with each other (rather than partially nudged) is
  // more internally coherent than blending each one separately with no
  // real per-market market-odds signal to blend against anyway.

  // Correct score top 3 — sort the raw matrix cells, take the top 3, and
  // report their probability relative to the SAME `total` normalizer
  // used for 1X2 above (consistent basis across every market).
  const correctScoreTop3 = cells
    .slice()
    .sort((a, b) => b.p - a.p)
    .slice(0, 3)
    .map((c) => ({ home: c.h, away: c.a, prob: round(c.p / total) }));

  const sampleSize = Math.min(homeForm.sampleSize, awayForm.sampleSize);
  const outcomes = [
    { key: "HOME", p: pHome },
    { key: "DRAW", p: pDraw },
    { key: "AWAY", p: pAway },
  ].sort((a, b) => b.p - a.p);

  const predictedOutcome = outcomes[0].key;
  const rawConfidence = outcomes[0].p;
  // Cap confidence hard when we don't have enough history yet — don't let
  // the model sound more sure of itself than the data supports.
  const confidence = sampleSize < MIN_SAMPLE_SIZE ? Math.min(rawConfidence, 0.45) : rawConfidence;

  const h2hNote = h2h.sampleSize > 0
    ? ` H2H over last ${h2h.sampleSize} meeting${h2h.sampleSize > 1 ? "s" : ""}: ${Math.round(h2h.homeWinRate * 100)}% home / ${Math.round(h2h.drawRate * 100)}% draw / ${Math.round(h2h.awayWinRate * 100)}% away.`
    : "";
  const fatigueNote =
    fatigueApplied.home && fatigueApplied.away
      ? " Both sides are on a short rest (<3 days) — expected goals adjusted for fixture congestion."
      : fatigueApplied.home
      ? " Home side is on a short rest (<3 days) — expected goals adjusted for fixture congestion."
      : fatigueApplied.away
      ? " Away side is on a short rest (<3 days) — expected goals adjusted for fixture congestion."
      : "";

  const justification =
    sampleSize < MIN_SAMPLE_SIZE
      ? `Limited match history (${sampleSize} games) — low-confidence estimate based on league averages.${h2hNote}${fatigueNote}`
      : `${outcomes[0].key === "HOME" ? "Home side" : outcomes[0].key === "AWAY" ? "Away side" : "A draw"} favored on weighted home/away-split form (${sampleSize}-match sample), with home advantage and league-relative attack/defense strength factored in.${h2hNote}${fatigueNote}`;

  return {
    probHome: round(pHome),
    probDraw: round(pDraw),
    probAway: round(pAway),
    bttsYesProb: round(pBttsYes),
    bttsNoProb: round(1 - pBttsYes),
    predictedOutcome,
    predictedBtts: pBttsYes >= 0.5,
    predictedHomeGoals: correctScoreTop3[0]?.home ?? null,
    predictedAwayGoals: correctScoreTop3[0]?.away ?? null,
    over25Prob: round(p25),
    under25Prob: round(1 - p25),
    predictedOver25: p25 >= 0.5,
    over15Prob: round(p15),
    under15Prob: round(1 - p15),
    over35Prob: round(p35),
    under35Prob: round(1 - p35),
    doubleChance1XProb: round(pHome + pDraw),
    doubleChance12Prob: round(pHome + pAway),
    doubleChanceX2Prob: round(pDraw + pAway),
    dnbHomeProb: round(pHome / (pHome + pAway)),
    dnbAwayProb: round(pAway / (pHome + pAway)),
    cleanSheetHomeProb: round(cleanSheetHome),
    cleanSheetAwayProb: round(cleanSheetAway),
    oddTotalProb: round(oddTotal),
    evenTotalProb: round(1 - oddTotal),
    correctScoreTop3,
    confidence: round(confidence),
    sampleSize,
    justification,
  };
}

/**
 * For sports that DO have a draw but are NOT football (handball, rugby,
 * AFL — see supportsDraw in config/sports.js). These have completely
 * different scoring scales and dynamics than football (handball routinely
 * finishes 28-25; rugby and AFL are try/goal-based with irregular scoring
 * increments), so running them through the football-calibrated Poisson
 * goal model would produce meaningless output — no expanded goal markets
 * here, just a 3-way win/draw/win probability off recent scoring form.
 *
 * This is a deliberately simple, sport-agnostic approximation — not
 * calibrated against each sport's actual historical draw frequency
 * (handball, rugby, and AFL all draw at very different real-world rates,
 * and PitchLine doesn't have that data), so treat the draw probability
 * here as a rough signal, not a precise one. Uses pooled (non-venue-split)
 * form, unaffected by the football-specific upgrades above.
 */
async function generateThreeWayPrediction(fixture) {
  const [homeForm, awayForm] = await Promise.all([
    getTeamForm(fixture.homeTeamId, fixture.kickoff),
    getTeamForm(fixture.awayTeamId, fixture.kickoff),
  ]);

  const homeDiff = homeForm.avgScored - homeForm.avgConceded;
  const awayDiff = awayForm.avgScored - awayForm.avgConceded;
  const homeAdvantage = 1; // modest edge, in the sport's own scoring units
  const gap = homeDiff - awayDiff + homeAdvantage;

  const pHomeIfDecided = 1 / (1 + Math.exp(-gap / 10));
  const pAwayIfDecided = 1 - pHomeIfDecided;

  const BASE_DRAW_RATE = 0.14;
  const closeness = Math.max(0, 1 - Math.abs(gap) / 15); // 1 = very even matchup, 0 = big mismatch
  const pDraw = BASE_DRAW_RATE * closeness;

  const pHome = pHomeIfDecided * (1 - pDraw);
  const pAway = pAwayIfDecided * (1 - pDraw);

  const sampleSize = Math.min(homeForm.sampleSize, awayForm.sampleSize);
  const outcomes = [
    { key: "HOME", p: pHome },
    { key: "DRAW", p: pDraw },
    { key: "AWAY", p: pAway },
  ].sort((a, b) => b.p - a.p);

  const predictedOutcome = outcomes[0].key;
  const rawConfidence = outcomes[0].p;
  const confidence = sampleSize < MIN_SAMPLE_SIZE ? Math.min(rawConfidence, 0.45) : rawConfidence;

  const justification =
    sampleSize < MIN_SAMPLE_SIZE
      ? `Limited match history (${sampleSize} games) — low-confidence estimate.`
      : `${predictedOutcome === "HOME" ? "Home side" : predictedOutcome === "AWAY" ? "Away side" : "A draw"} favored on recent scoring differential (${sampleSize}-match sample). Draw probability is a rough sport-agnostic estimate, not calibrated to this sport's actual historical draw rate.`;

  return {
    probHome: round(pHome),
    probDraw: round(pDraw),
    probAway: round(pAway),
    bttsYesProb: null,
    bttsNoProb: null,
    predictedOutcome,
    predictedBtts: null,
    predictedHomeGoals: null,
    predictedAwayGoals: null,
    over25Prob: null,
    under25Prob: null,
    predictedOver25: null,
    ...EMPTY_EXPANDED_MARKETS,
    confidence: round(confidence),
    sampleSize,
    justification,
  };
}

/**
 * Two-way win-probability model for sports with no draw outcome
 * (basketball, hockey, baseball, volleyball, NFL — API-Sports resolves a
 * final winner via OT/SO/extra innings). Deliberately simpler than the
 * football Poisson model: these sports' scoring volume/style makes a
 * goals-based Poisson grid a poor fit, so this uses a logistic function
 * on each side's scoring differential instead. Same zero-API-cost
 * principle — reads only fixtures already in our DB. Uses pooled
 * (non-venue-split) form, unaffected by the football-specific upgrades
 * above.
 */
async function generateTwoWayPrediction(fixture) {
  const [homeForm, awayForm] = await Promise.all([
    getTeamForm(fixture.homeTeamId, fixture.kickoff),
    getTeamForm(fixture.awayTeamId, fixture.kickoff),
  ]);

  const homeDiff = homeForm.avgScored - homeForm.avgConceded;
  const awayDiff = awayForm.avgScored - awayForm.avgConceded;
  const homeAdvantage = 2; // small home-court/ice edge, in the sport's own scoring units

  // Logistic on the strength gap — steepness tuned conservatively so we
  // don't sound falsely confident on a thin sample.
  const gap = homeDiff - awayDiff + homeAdvantage;
  const pHome = 1 / (1 + Math.exp(-gap / 8));
  const pAway = 1 - pHome;

  const sampleSize = Math.min(homeForm.sampleSize, awayForm.sampleSize);
  const predictedOutcome = pHome >= pAway ? "HOME" : "AWAY";
  const rawConfidence = Math.max(pHome, pAway);
  const confidence = sampleSize < MIN_SAMPLE_SIZE ? Math.min(rawConfidence, 0.45) : rawConfidence;

  const justification =
    sampleSize < MIN_SAMPLE_SIZE
      ? `Limited match history (${sampleSize} games) — low-confidence estimate.`
      : `${predictedOutcome === "HOME" ? "Home side" : "Away side"} favored on weighted recent scoring differential (${sampleSize}-match sample).`;

  return {
    probHome: round(pHome),
    probDraw: 0,
    probAway: round(pAway),
    bttsYesProb: null,
    bttsNoProb: null,
    predictedOutcome,
    predictedBtts: null,
    predictedHomeGoals: null,
    predictedAwayGoals: null,
    over25Prob: null,
    under25Prob: null,
    predictedOver25: null,
    ...EMPTY_EXPANDED_MARKETS,
    confidence: round(confidence),
    sampleSize,
    justification,
  };
}

module.exports = {
  generatePrediction,
  generateThreeWayPrediction,
  generateTwoWayPrediction,
  getTeamForm,
  getH2hSignal,
  MIN_SAMPLE_SIZE,
  // New helpers (upgrades 2 & 4) — not required by the original contract,
  // exported for testability / reuse (e.g. by an admin diagnostics view).
  getLeagueAverageGoals,
  getRestDays,
};
