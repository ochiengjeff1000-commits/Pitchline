const axios = require("axios");
const { SlidingWindowRateLimiter } = require("../lib/rateLimiter");

const BASE_URL = "https://api.football-data.org/v4";

// football-data.org's free tier gives access to exactly these 12
// competitions — getMatches() naturally only returns matches within
// whatever the token has access to, so no client-side filtering is
// needed, but this map documents (and drives tiering + standings for)
// that exact set.
const COMPETITION_TIER_MAP = {
  PL: "TIER_1",   // Premier League
  CL: "TIER_1",   // UEFA Champions League
  PD: "TIER_1",   // La Liga (Primera Division)
  SA: "TIER_1",   // Serie A
  BL1: "TIER_1",  // Bundesliga
  FL1: "TIER_2",  // Ligue 1
  ELC: "TIER_2",  // Championship
  DED: "TIER_2",  // Eredivisie
  PPL: "TIER_2",  // Primeira Liga
  BSA: "TIER_2",  // Campeonato Brasileiro Série A
  WC: "TIER_1",   // FIFA World Cup
  EC: "TIER_1",   // UEFA European Championship
};

// Domestic-league competitions we keep a standings table for (WC/EC are
// tournaments — group tables only exist mid-tournament, so they're left
// out of the routine standings refresh and can be added on-demand later).
const STANDINGS_COMPETITIONS = ["PL", "CL", "PD", "SA", "BL1", "FL1", "ELC", "DED", "PPL", "BSA"];

// Free tier hard limit is 10 requests/minute — this is enforced for real,
// not just logged, and is shared across every caller of this module
// (footballDataSync's fixture window pull and standingsSync's table pull
// alike) since they draw from the same provider-side quota.
const limiter = new SlidingWindowRateLimiter(10, 60 * 1000);

let callsThisProcess = 0;

function client() {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  return axios.create({
    baseURL: BASE_URL,
    headers: token ? { "X-Auth-Token": token } : {},
    timeout: 15000,
  });
}

/**
 * Fetches every match in a date range in ONE request — the free tier
 * supports dateFrom/dateTo directly.
 * @param {string} dateFrom YYYY-MM-DD
 * @param {string} dateTo YYYY-MM-DD
 */
async function getMatches(dateFrom, dateTo) {
  try {
    await limiter.acquire();
    callsThisProcess += 1;
    const { data } = await client().get("/matches", { params: { dateFrom, dateTo } });
    return data.matches || [];
  } catch (err) {
    console.error("[footballDataClient] Failed to fetch matches:", err.response?.data?.message || err.message);
    return [];
  }
}

/**
 * Fetches the current league table for one competition (e.g. "PL").
 * Used to keep StandingsCache fresh for supported top-tier competitions.
 */
async function getStandings(competitionCode) {
  try {
    await limiter.acquire();
    callsThisProcess += 1;
    const { data } = await client().get(`/competitions/${competitionCode}/standings`);
    const overall = (data.standings || []).find((s) => s.type === "TOTAL") || data.standings?.[0];
    if (!overall) return null;

    return {
      competitionApiId: data.competition?.id,
      competitionName: data.competition?.name,
      season: data.season?.startDate ? new Date(data.season.startDate).getFullYear() : new Date().getFullYear(),
      table: (overall.table || []).map((row) => ({
        rank: row.position,
        teamApiId: row.team?.id,
        teamName: row.team?.name,
        logoUrl: row.team?.crest,
        played: row.playedGames,
        win: row.won,
        draw: row.draw,
        lose: row.lost,
        goalsDiff: row.goalDifference,
        points: row.points,
      })),
    };
  } catch (err) {
    console.error(`[footballDataClient] Failed to fetch standings for ${competitionCode}:`, err.response?.data?.message || err.message);
    return null;
  }
}

function getCallCount() {
  return callsThisProcess;
}

function tierForCompetitionCode(code) {
  return COMPETITION_TIER_MAP[code] || "TIER_3";
}

module.exports = {
  getMatches,
  getStandings,
  getCallCount,
  tierForCompetitionCode,
  COMPETITION_TIER_MAP,
  STANDINGS_COMPETITIONS,
};
