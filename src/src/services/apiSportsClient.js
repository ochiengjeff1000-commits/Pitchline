const axios = require("axios");
const { SPORTS } = require("../config/sports");

// Per-sport quota exhaustion flags — a 429/rateLimit error on one sport's
// product (e.g. Basketball) must not block a different sport's product
// (e.g. Football), since API-Sports meters each v1/v3 product separately.
const quotaExhaustedUntil = {};

function checkQuotaStatus(sport) {
  const until = quotaExhaustedUntil[sport];
  if (!until) return false;
  if (Date.now() > until) {
    delete quotaExhaustedUntil[sport];
    return false;
  }
  return true;
}

function markQuotaExhausted(sport) {
  const now = new Date();
  const tomorrowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0));
  quotaExhaustedUntil[sport] = tomorrowUTC.getTime();
}

// Soft daily budget per sport product — the free tier's hard limit is
// 100/day; stopping a little short avoids ever actually hitting a 429
// (and the markQuotaExhausted() penalty that comes with one) during
// normal operation. Resets at UTC midnight.
const DAILY_SOFT_CAP = 95;
const dailyCallLog = {}; // sport -> { day: 'YYYY-MM-DD', count: n }

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function underSoftCap(sport) {
  const log = dailyCallLog[sport];
  const day = todayUTC();
  if (!log || log.day !== day) return true;
  return log.count < DAILY_SOFT_CAP;
}

function recordCall(sport) {
  const day = todayUTC();
  if (!dailyCallLog[sport] || dailyCallLog[sport].day !== day) {
    dailyCallLog[sport] = { day, count: 0 };
  }
  dailyCallLog[sport].count += 1;
}

class ApiSportsClient {
  constructor(sport = "FOOTBALL") {
    this.sport = sport;
    const config = SPORTS[sport] || SPORTS.FOOTBALL;
    this.config = config;
    this.baseUrl = config.baseUrl;
    this.apiKey = process.env[config.apiKeyEnv];
    this.callCount = 0; // calls made by THIS instance in the current process — used for SyncLog reporting
  }

  async request(endpoint, params = {}) {
    if (!this.apiKey) return [];
    if (checkQuotaStatus(this.sport)) return [];
    if (!underSoftCap(this.sport)) return [];

    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        headers: {
          "x-apisports-key": this.apiKey,
        },
        params,
        timeout: 10000,
      });

      this.callCount += 1;
      recordCall(this.sport);

      const data = response.data;
      if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)) {
        const errText = JSON.stringify(data.errors).toLowerCase();
        if (errText.includes("request") || errText.includes("rate") || errText.includes("limit")) {
          markQuotaExhausted(this.sport);
        }
        return [];
      }

      return data.response || [];
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) markQuotaExhausted(this.sport);
      return [];
    }
  }

  getCallCount() {
    return this.callCount;
  }

  // --- Fixture & Metadata endpoints ---
  /** One request per (sport, date) — the core budget cost the whole quota strategy is built around. */
  async getFixturesByDate(date) {
    return this.request(this.config.fixturesPath, { date });
  }
  /** Legacy generic accessor, kept for callers that already build their own params. */
  async getFixtures(params) { return this.request(this.config.fixturesPath, params); }

  /**
   * Batch-checks up to 20 fixtures by id in a single request (API-Sports'
   * `ids=1-2-3` dash-separated batch syntax) — used by settlementJob to
   * cheaply re-check many pending fixtures at once instead of one call each.
   */
  async getFixturesByIds(apiIds) {
    if (!apiIds || apiIds.length === 0) return [];
    return this.request(this.config.fixturesPath, { ids: apiIds.join("-") });
  }

  async getHeadToHead(homeApiId, awayApiId) {
    return this.request("/fixtures/headtohead", { h2h: `${homeApiId}-${awayApiId}` });
  }
  async getTeamInfo(teamId) { return this.request("/teams", { id: teamId }); }
  async getSquad(teamId) { return this.request("/players/squads", { team: teamId }); }
  async getStandings(leagueId, season) { return this.request("/standings", { league: leagueId, season }); }

  // --- On-demand deep telemetry (only called when a user opens a match
  // modal — see server.js — never on a polling cadence, to keep quota use
  // predictable). Football-only; other sport products don't expose the
  // same event/stat/lineup endpoints under these paths.
  async getFixtureEvents(fixtureApiId) {
    if (this.sport !== "FOOTBALL") return [];
    return this.request("/fixtures/events", { fixture: fixtureApiId });
  }
  async getFixtureStats(fixtureApiId) {
    if (this.sport !== "FOOTBALL") return [];
    return this.request("/fixtures/statistics", { fixture: fixtureApiId });
  }
  async getFixtureLineups(fixtureApiId) {
    if (this.sport !== "FOOTBALL") return [];
    return this.request("/fixtures/lineups", { fixture: fixtureApiId });
  }
}

const clients = {};
function getClient(sport = "FOOTBALL") {
  if (!clients[sport]) clients[sport] = new ApiSportsClient(sport);
  return clients[sport];
}

module.exports = { getClient, ApiSportsClient };
