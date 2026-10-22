//
// Powers GET /api/teams/:id/profile. Recent results, upcoming fixtures,
// and league membership all come straight from the DB. Country, venue,
// squad, and standings position are backfilled on-demand here and cached.
const prisma = require("../lib/prisma");
const { getClient } = require("./apiSportsClient");

const SQUAD_STALE_AFTER_DAYS = 14;
const STANDINGS_STALE_AFTER_HOURS = 6;
const PROFILE_RECHECK_AFTER_DAYS = 30;

function daysSince(date) {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}
function hoursSince(date) {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

/** Backfills country/venue onto the Team row if missing and not recently checked. */
async function ensureTeamInfo(team) {
  if (team.sport !== "FOOTBALL") return team;
  if (team.country && team.venueName) return team;
  if (team.profileCheckedAt && daysSince(team.profileCheckedAt) < PROFILE_RECHECK_AFTER_DAYS) return team;

  try {
    const client = getClient("FOOTBALL");
    const [info] = await client.getTeamInfo(team.apiId);
    const updated = await prisma.team.update({
      where: { id: team.id },
      data: {
        country: info?.team?.country ?? team.country,
        venueName: info?.venue?.name ?? team.venueName,
        venueCity: info?.venue?.city ?? team.venueCity,
        profileCheckedAt: new Date(),
      },
    });
    return updated;
  } catch (err) {
    console.error(`[teamProfileService] getTeamInfo failed for team ${team.id}:`, err.message);
    return prisma.team.update({ where: { id: team.id }, data: { profileCheckedAt: new Date() } });
  }
}

/** Backfills the cached squad JSON if missing/stale. */
async function ensureSquad(team) {
  if (team.sport !== "FOOTBALL") return [];
  if (team.squadJson && daysSince(team.squadCachedAt) < SQUAD_STALE_AFTER_DAYS) {
    return team.squadJson;
  }

  try {
    const client = getClient("FOOTBALL");
    const [squadResp] = await client.getSquad(team.apiId);
    const players = (squadResp?.players || []).map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number ?? null,
      position: p.position ?? null,
      photoUrl: p.photo ?? null,
    }));
    await prisma.team.update({
      where: { id: team.id },
      data: { squadJson: players, squadCachedAt: new Date() },
    });
    return players;
  } catch (err) {
    console.error(`[teamProfileService] getSquad failed for team ${team.id}:`, err.message);
    // Touch squadCachedAt to prevent rate-limited API calls on every profile request
    try {
      await prisma.team.update({
        where: { id: team.id },
        data: { squadCachedAt: new Date() },
      });
    } catch (dbErr) {}
    return team.squadJson || [];
  }
}

/** Backfills/reads cached league standings and pulls this team's row out of it. */
async function getStandingsPosition(team, leagueApiId, leagueId) {
  if (team.sport !== "FOOTBALL" || !leagueApiId) return null;

  const season = new Date().getFullYear();
  let cache = await prisma.standingsCache.findUnique({ where: { leagueId_season: { leagueId, season } } });

  if (!cache || hoursSince(cache.updatedAt) > STANDINGS_STALE_AFTER_HOURS) {
    try {
      const client = getClient("FOOTBALL");
      const [resp] = await client.getStandings(leagueApiId, season);
      const table = resp?.league?.standings?.[0] || [];
      const rows = table.map((row) => ({
        rank: row.rank,
        teamApiId: row.team.id,
        teamName: row.team.name,
        played: row.all?.played ?? 0,
        win: row.all?.win ?? 0,
        draw: row.all?.draw ?? 0,
        lose: row.all?.lose ?? 0,
        goalsDiff: row.goalsDiff ?? 0,
        points: row.points ?? 0,
      }));
      cache = await prisma.standingsCache.upsert({
        where: { leagueId_season: { leagueId, season } },
        update: { data: rows, updatedAt: new Date() },
        create: { leagueId, season, data: rows },
      });
    } catch (err) {
      console.error(`[teamProfileService] getStandings failed for league ${leagueApiId}:`, err.message);
      if (!cache) {
        // Record timestamp so rate-limited requests don't retry repeatedly
        try {
          cache = await prisma.standingsCache.upsert({
            where: { leagueId_season: { leagueId, season } },
            update: { updatedAt: new Date() },
            create: { leagueId, season, data: [] },
          });
        } catch (dbErr) {}
        return null;
      }
    }
  }

  const rows = cache.data || [];
  return rows.find((r) => r.teamApiId === team.apiId) || null;
}

async function getTeamProfile(teamId) {
  let team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return null;

  team = await ensureTeamInfo(team);

  const [recentGames, upcomingFixtures, mostRecentLeagueFixture, squad] = await Promise.all([
    prisma.fixture.findMany({
      where: { status: "FINISHED", OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
      orderBy: { kickoff: "desc" },
      take: 5,
      include: { homeTeam: true, awayTeam: true, league: true },
    }),
    prisma.fixture.findMany({
      where: { status: "SCHEDULED", OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
      orderBy: { kickoff: "asc" },
      take: 5,
      include: { homeTeam: true, awayTeam: true, league: true },
    }),
    prisma.fixture.findFirst({
      where: { OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
      orderBy: { kickoff: "desc" },
      include: { league: true },
    }),
    ensureSquad(team),
  ]);

  const standings = mostRecentLeagueFixture
    ? await getStandingsPosition(team, mostRecentLeagueFixture.league.apiId, mostRecentLeagueFixture.league.id)
    : null;

  const gameSummary = (f) => ({
    id: f.id,
    kickoff: f.kickoff,
    competition: f.league.name,
    homeTeam: f.homeTeam.name,
    awayTeam: f.awayTeam.name,
    homeScore: f.homeScore,
    awayScore: f.awayScore,
  });

  return {
    id: team.id,
    name: team.name,
    sport: team.sport,
    logoUrl: team.logoUrl,
    country: team.country,
    venue: team.venueName ? { name: team.venueName, city: team.venueCity } : null,
    standings: standings
      ? {
          leagueName: mostRecentLeagueFixture.league.name,
          rank: standings.rank,
          played: standings.played,
          win: standings.win,
          draw: standings.draw,
          lose: standings.lose,
          goalsDiff: standings.goalsDiff,
          points: standings.points,
        }
      : null,
    squad,
    recentGames: recentGames.map(gameSummary),
    upcomingFixtures: upcomingFixtures.map(gameSummary),
  };
}

module.exports = { getTeamProfile };