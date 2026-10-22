const axios = require("axios");
const { normalizeTeamName } = require("../lib/teamNameNormalize");

const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/**
 * Maps ESPN's status shape to our FixtureStatus enum values, distinguishing
 * halftime from general "in progress" (both report state === 'in', but
 * halftime carries its own status.type.name).
 */
function mapEspnStatus(statusObj) {
  const state = statusObj?.type?.state; // 'pre' | 'in' | 'post'
  const name = statusObj?.type?.name || "";
  if (state === "post") return "FINISHED";
  if (state === "in") {
    return name === "STATUS_HALFTIME" ? "HALFTIME" : "LIVE";
  }
  return "SCHEDULED";
}

/**
 * Fetches live scores & match details for active soccer matches worldwide.
 */
async function getLiveScoreboard(league = "all") {
  try {
    const { data } = await axios.get(`${BASE_URL}/${league}/scoreboard`, { timeout: 10000 });
    return data.events || [];
  } catch (err) {
    console.error("[espnClient] Failed to fetch live scoreboard:", err.message);
    return [];
  }
}

/**
 * Fetches match details: events (goals/cards), stats, and lineups.
 */
async function getMatchSummary(espnEventId, league = "all") {
  try {
    const { data } = await axios.get(`${BASE_URL}/${league}/summary`, {
      params: { event: espnEventId },
      timeout: 10000,
    });

    const header = data.header?.competitions?.[0] || {};
    const boxscore = data.boxscore || {};

    const teamsStats = boxscore.teams || [];
    const homeStats = teamsStats[0]?.statistics || [];
    const awayStats = teamsStats[1]?.statistics || [];

    const getStat = (statsList, name) => {
      const found = statsList.find((s) => s.name === name || s.label === name);
      return found ? found.displayValue : "0";
    };

    const rawKeyEvents = data.keyEvents || [];
    const timeline = rawKeyEvents.map((evt) => ({
      minute: parseInt(evt.clock?.displayValue || "0", 10),
      type: evt.type?.text || "Event",
      text: evt.text || "",
      team: evt.team?.displayName || "",
    }));

    const rawPlayers = boxscore.players || [];
    const lineups = rawPlayers.map((teamLineup) => ({
      team: teamLineup.team?.displayName,
      formation: teamLineup.formation || "N/A",
      starters: (teamLineup.statistics?.[0]?.athletes || []).map((p) => ({
        id: p.athlete?.id,
        name: p.athlete?.displayName,
        jersey: p.athlete?.jersey,
        position: p.athlete?.position?.abbreviation,
      })),
    }));

    const hasStats = homeStats.length > 0 || awayStats.length > 0;

    return {
      available: true,
      hasStats,
      homeScore: header.competitors?.[0]?.score || "0",
      awayScore: header.competitors?.[1]?.score || "0",
      clock: header.status?.displayClock || "0'",
      statusState: header.status?.type?.state || "pre",
      timeline,
      stats: {
        possession: [getStat(homeStats, "possession") || "50%", getStat(awayStats, "possession") || "50%"],
        shotsOnTarget: [getStat(homeStats, "shotsOnTarget"), getStat(awayStats, "shotsOnTarget")],
        shotsTotal: [getStat(homeStats, "totalShots"), getStat(awayStats, "totalShots")],
        corners: [getStat(homeStats, "wonCorners"), getStat(awayStats, "wonCorners")],
        fouls: [getStat(homeStats, "foulsCommitted"), getStat(awayStats, "foulsCommitted")],
      },
      lineups,
    };
  } catch (err) {
    if (err.response?.status !== 404) {
      console.error("[espnClient] Match summary error:", err.message);
    }
    return { available: false, hasStats: false, timeline: [], stats: {}, lineups: [] };
  }
}

/**
 * Searches ESPN's scoreboard by team names if espnEventId isn't stored.
 */
async function getInsightsByTeams(homeTeamName, awayTeamName) {
  const events = await getLiveScoreboard("all");
  
  const targetHome = normalizeTeamName(homeTeamName);
  const targetAway = normalizeTeamName(awayTeamName);

  const matchedEvent = events.find((evt) => {
    const comp = evt.competitions?.[0];
    if (!comp) return false;
    const hName = normalizeTeamName(comp.competitors?.[0]?.team?.name || comp.competitors?.[0]?.team?.displayName);
    const aName = normalizeTeamName(comp.competitors?.[1]?.team?.name || comp.competitors?.[1]?.team?.displayName);
    return (hName.includes(targetHome) || targetHome.includes(hName)) &&
           (aName.includes(targetAway) || targetAway.includes(aName));
  });

  if (!matchedEvent) {
    return { available: false, hasStats: false, timeline: [], stats: {}, lineups: [] };
  }

  return getMatchSummary(matchedEvent.id);
}

module.exports = { getLiveScoreboard, getMatchSummary, getInsightsByTeams, mapEspnStatus };