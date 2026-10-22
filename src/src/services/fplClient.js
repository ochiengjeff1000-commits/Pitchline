const axios = require("axios");
const prisma = require("../lib/prisma");

// Official public FPL endpoints — unauthenticated, no key required.
// Not part of API-Sports, so none of this touches that quota. Still,
// this is Premier League's own infrastructure — cache aggressively
// (see the sync cadence in fplSync.js) rather than hitting it per visitor.
const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const FIXTURES_URL = "https://fantasy.premierleague.com/api/fixtures/";
const LIVE_URL = (gameweek) => `https://fantasy.premierleague.com/api/event/${gameweek}/live/`;

const POSITION_MAP = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

// FPL's API rejects requests without a browser-like User-Agent (403).
const FPL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

/**
 * Pulls players + teams + fixtures + gameweek metadata and caches them
 * into FplPlayer / FplFixture / FplGameweek. Idempotent — safe to run on
 * a schedule.
 */
async function syncFplData() {
  const [{ data: bootstrap }, { data: fixtures }] = await Promise.all([
    axios.get(BOOTSTRAP_URL, { timeout: 15000, headers: FPL_HEADERS }),
    axios.get(FIXTURES_URL, { timeout: 15000, headers: FPL_HEADERS }),
  ]);

  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t.name]));

  let playersUpserted = 0;
  for (const el of bootstrap.elements) {
    // FPL's photo CDN (resources.premierleague.com/.../p{id}.png) keys
    // off `element.photo` (e.g. "58822.jpg" -> photo id "58822"), NOT
    // `element.code` — those are two different internal identifiers.
    // Previously this prioritized `el.code` first, which is present for
    // almost every player, so the correct `el.photo` fallback never
    // actually ran — that's why most avatars were broken, not just "some".
    const photoId = el.photo
      ? String(el.photo).replace(/\.(jpg|png)$/i, "")
      : el.code
        ? String(el.code)
        : null;

    await prisma.fplPlayer.upsert({
      where: { fplId: el.id },
      update: {
        firstName: el.first_name,
        lastName: el.second_name,
        teamName: teamsById.get(el.team) || "Unknown",
        position: POSITION_MAP[el.element_type] || "UNK",
        priceTenths: el.now_cost,
        form: parseFloat(el.form) || 0,
        totalPoints: el.total_points,
        selectedByPercent: parseFloat(el.selected_by_percent) || 0,
        photoId,
        status: el.status,
        news: el.news || null,
        epNext: el.ep_next ? parseFloat(el.ep_next) : null,
      },
      create: {
        fplId: el.id,
        firstName: el.first_name,
        lastName: el.second_name,
        teamName: teamsById.get(el.team) || "Unknown",
        position: POSITION_MAP[el.element_type] || "UNK",
        priceTenths: el.now_cost,
        form: parseFloat(el.form) || 0,
        totalPoints: el.total_points,
        selectedByPercent: parseFloat(el.selected_by_percent) || 0,
        photoId,
        status: el.status,
        news: el.news || null,
        epNext: el.ep_next ? parseFloat(el.ep_next) : null,
      },
    });
    playersUpserted += 1;
  }

  let fixturesUpserted = 0;
  for (const f of fixtures) {
    if (!f.event) continue; // unscheduled/blank-gameweek fixtures have event=null
    await prisma.fplFixture.upsert({
      where: { fplId: f.id },
      update: {
        gameweek: f.event,
        homeDifficulty: f.team_h_difficulty,
        awayDifficulty: f.team_a_difficulty,
        kickoff: f.kickoff_time ? new Date(f.kickoff_time) : null,
      },
      create: {
        fplId: f.id,
        gameweek: f.event,
        homeTeamName: teamsById.get(f.team_h) || "Unknown",
        awayTeamName: teamsById.get(f.team_a) || "Unknown",
        homeDifficulty: f.team_h_difficulty,
        awayDifficulty: f.team_a_difficulty,
        kickoff: f.kickoff_time ? new Date(f.kickoff_time) : null,
      },
    });
    fixturesUpserted += 1;
  }

  let gameweeksUpserted = 0;
  for (const ev of bootstrap.events) {
    await prisma.fplGameweek.upsert({
      where: { id: ev.id },
      update: {
        deadlineTime: ev.deadline_time ? new Date(ev.deadline_time) : null,
        isCurrent: Boolean(ev.is_current),
        isNext: Boolean(ev.is_next),
        finished: Boolean(ev.finished),
      },
      create: {
        id: ev.id,
        deadlineTime: ev.deadline_time ? new Date(ev.deadline_time) : null,
        isCurrent: Boolean(ev.is_current),
        isNext: Boolean(ev.is_next),
        finished: Boolean(ev.finished),
      },
    });
    gameweeksUpserted += 1;
  }

  const currentEvent = bootstrap.events.find((e) => e.is_current) || bootstrap.events.find((e) => e.is_next);

  return { playersUpserted, fixturesUpserted, gameweeksUpserted, currentGameweek: currentEvent?.id || null };
}

/**
 * Fetches actual per-player points for one finished (or in-progress)
 * gameweek from FPL's live endpoint. Returns a Map keyed by fplId ->
 * { points, minutes }.
 */
async function fetchGameweekLivePoints(gameweek) {
  const { data } = await axios.get(LIVE_URL(gameweek), { timeout: 15000, headers: FPL_HEADERS });
  const map = new Map();
  for (const el of data.elements || []) {
    map.set(el.id, {
      points: el.stats?.total_points ?? 0,
      minutes: el.stats?.minutes ?? 0,
    });
  }
  return map;
}

/**
 * Backfills real points for a gameweek's stored squad recommendation,
 * once that gameweek has finished. Mirrors FPL's own captaincy rule:
 * the captain's points are doubled UNLESS they didn't play at all (0
 * minutes), in which case the vice-captain's points are doubled instead.
 */
async function syncGameweekPoints(gameweek) {
  const record = await prisma.fplSquadRecommendation.findUnique({ where: { gameweek } });
  if (!record) return null;

  const livePoints = await fetchGameweekLivePoints(gameweek);
  const squad = record.squad;

  const withPoints = squad.map((p) => {
    const live = livePoints.get(p.fplPlayerId);
    return { ...p, actualPoints: live?.points ?? 0, minutesPlayed: live?.minutes ?? 0 };
  });

  const starters = withPoints.filter((p) => p.isStarting);
  const captain = starters.find((p) => p.isCaptain);
  const vice = starters.find((p) => p.isVice);
  const captainPlayed = captain && captain.minutesPlayed > 0;
  const doubledId = captainPlayed ? captain?.fplPlayerId : vice?.fplPlayerId;

  const totalPointsEarned = starters.reduce((sum, p) => {
    const multiplier = p.fplPlayerId === doubledId ? 2 : 1;
    return sum + p.actualPoints * multiplier;
  }, 0);

  await prisma.fplSquadRecommendation.update({
    where: { gameweek },
    data: { squad: withPoints, totalPointsEarned },
  });

  return totalPointsEarned;
}

/**
 * Finds every gameweek that's finished but whose stored squad
 * recommendation hasn't had its real points backfilled yet, and syncs
 * them. Safe to call repeatedly — a no-op once everything's backfilled.
 */
async function backfillFinishedGameweekPoints() {
  const finishedGameweeks = await prisma.fplGameweek.findMany({ where: { finished: true }, select: { id: true } });
  const finishedIds = new Set(finishedGameweeks.map((g) => g.id));

  const candidates = await prisma.fplSquadRecommendation.findMany({
    where: { totalPointsEarned: null },
    select: { gameweek: true },
  });

  let synced = 0;
  for (const { gameweek } of candidates) {
    if (!finishedIds.has(gameweek)) continue;
    try {
      await syncGameweekPoints(gameweek);
      synced += 1;
    } catch (err) {
      console.error(`[fplClient] failed to backfill points for GW${gameweek}:`, err.message);
    }
  }
  return synced;
}

module.exports = { syncFplData, fetchGameweekLivePoints, syncGameweekPoints, backfillFinishedGameweekPoints };
