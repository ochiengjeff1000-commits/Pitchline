/**
 * PitchLine Automated Scheduler — orchestrates the real job modules.
 * Every job here is a thin wrapper; the actual logic lives in src/jobs/*
 * and src/services/* so it can be unit-tested and run manually
 * (npm run *:now) independent of the cron wiring.
 *
 * Provider responsibilities (deliberately non-overlapping so each
 * provider's quota is spent on exactly one job):
 *
 *  - API-Sports (100 requests/day free tier): SCHEDULE SYNC ONLY. Pulls
 *    the full fixture list three times a day — 02:00, 13:00, 17:00 —
 *    covering every enabled sport. It is NOT polled for live scores;
 *    that quota stays reserved for fixture data. (It's still used as a
 *    narrow on-demand fallback inside a couple of routes — see notes
 *    below — but nothing on a recurring schedule touches it beyond the
 *    three daily syncs.)
 *
 *  - football-data.org (10 requests/minute free tier): the 12 free-tier
 *    competitions (PL, CL, PD, SA, BL1, FL1, ELC, DED, PPL, BSA, WC, EC).
 *    Fixture + live-state sync every 1 minute, standings every 20
 *    minutes — both routed through footballDataClient's built-in
 *    sliding-window limiter, so they can never exceed 10/min combined.
 *
 *  - ESPN (unmetered): responsible for ALL live football — score, clock,
 *    period state, and match stats/events/lineups — via a tight 20s
 *    ticker (runEspnLiveTick) plus on-demand summary calls from the
 *    live-events/stats/lineups routes in server.js. Nothing about live
 *    football touches a metered provider unless ESPN genuinely has no
 *    data for that match (see server.js's ESPN-first, API-Sports-
 *    fallback-only-if-needed logic in those three routes, and
 *    settlementJob's ESPN-first settlement check below).
 */
const cron = require("node-cron");
const { runDailyFixtureSync } = require("../jobs/dailyFixtureSync");
const { runFootballDataSync } = require("../jobs/footballDataSync");
const { runStandingsSync } = require("../jobs/standingsSync");
const { runPostponementCheck } = require("../jobs/postponementCheck");
const { runSettlementJob } = require("../jobs/settlementJob");
const { runEspnLiveTick, runStuckMatchGuard } = require("../jobs/livePollingJob");
const { runNonFootballLiveTick } = require("../jobs/nonFootballLiveTick");
const { runNewsSync } = require("../jobs/newsSync");
const { runFplSync } = require("../jobs/fplSync");
const { runFplSquadGen } = require("../jobs/fplSquadGen");
const { runJackpotAutoSync } = require("../jobs/jackpotAutoSync");

const ESPN_TICK_MS = 20 * 1000; // 20s — within the required 15-30s window

function startScheduler() {
  // ---- API-Sports: fixture/schedule sync, exactly 3x/day, 100/day quota ----
  cron.schedule("0 2 * * *", async () => {
    console.log("[cron] dailyFixtureSync (02:00)");
    try { await runDailyFixtureSync(); } catch (err) { console.error("[cron] dailyFixtureSync (02:00) error:", err.message); }
  });
  cron.schedule("0 13 * * *", async () => {
    console.log("[cron] dailyFixtureSync (13:00)");
    try { await runDailyFixtureSync(); } catch (err) { console.error("[cron] dailyFixtureSync (13:00) error:", err.message); }
  });
  cron.schedule("0 17 * * *", async () => {
    console.log("[cron] dailyFixtureSync (17:00)");
    try { await runDailyFixtureSync(); } catch (err) { console.error("[cron] dailyFixtureSync (17:00) error:", err.message); }
  });

  // ---- football-data.org: the 12 free-tier leagues, fixtures + live state ----
  // One request per run, safely inside the 10/min limiter even with overlap.
  cron.schedule("*/1 * * * *", async () => {
    try { await runFootballDataSync(); } catch (err) { console.error("[cron] footballDataSync error:", err.message); }
  });

  // ---- football-data.org: league standings for those same leagues ----
  cron.schedule("*/20 * * * *", async () => {
    try { await runStandingsSync(); } catch (err) { console.error("[cron] standingsSync error:", err.message); }
  });

  // ---- ESPN: unmetered real-time ticker — every 20s, every live match ----
  const espnTick = async () => {
    try { await runEspnLiveTick(); } catch (err) { console.error("[cron] espnLiveTick error:", err.message); }
  };
  espnTick();
  setInterval(espnTick, ESPN_TICK_MS);

  // ---- Stuck-match guard — every 5 minutes ----
  cron.schedule("*/5 * * * *", async () => {
    try { await runStuckMatchGuard(); } catch (err) { console.error("[cron] stuckMatchGuard error:", err.message); }
  });

  // ---- Non-football live tick — every 5 minutes ----
  // Basketball/hockey/etc have no unmetered ticker like football's ESPN
  // feed, so this gives them their own frequent (but dormancy-gated,
  // quota-safe) live refresh instead of waiting on the 30-min settlement
  // job alone.
  cron.schedule("*/5 * * * *", async () => {
    try { await runNonFootballLiveTick(); } catch (err) { console.error("[cron] nonFootballLiveTick error:", err.message); }
  });

  // ---- Postponement/kickoff-shift check — 13:30, right after the 13:00 sync ----
  cron.schedule("30 13 * * *", async () => {
    console.log("[cron] postponementCheck");
    try { await runPostponementCheck(); } catch (err) { console.error("[cron] postponementCheck error:", err.message); }
  });

  // ---- Settlement & jackpot accuracy engine — every 30 minutes ----
  // ESPN-first for football (see settlementJob.js); API-Sports batch-by-id
  // only covers what ESPN couldn't settle, plus non-football sports.
  cron.schedule("*/30 * * * *", async () => {
    try { await runSettlementJob(); } catch (err) { console.error("[cron] settlementJob error:", err.message); }
  });

  // ---- News aggregator (RSS, free, unmetered) — every 2 hours ----
  cron.schedule("0 */2 * * *", async () => {
    console.log("[cron] newsSync");
    try { await runNewsSync(); } catch (err) { console.error("[cron] newsSync error:", err.message); }
  });

  // ---- FPL data sync (public FPL API, free, unmetered) — every 6 hours ----
  cron.schedule("0 */6 * * *", async () => {
    console.log("[cron] fplSync");
    try { await runFplSync(); } catch (err) { console.error("[cron] fplSync error:", err.message); }
  });

  // ---- Weekly PitchLine XI generation — Monday 06:00 ----
  cron.schedule("0 6 * * 1", async () => {
    console.log("[cron] fplSquadGen");
    try { await runFplSquadGen(); } catch (err) { console.error("[cron] fplSquadGen error:", err.message); }
  });

  // ---- Jackpot auto-sync — every 3 hours ----
  // Pulls from any of the 4 platform adapters that has an endpoint
  // configured (see src/services/jackpotSources/); no-ops harmlessly for
  // any that don't yet. Results land in NEEDS_REVIEW for admin approval.
  cron.schedule("0 */3 * * *", async () => {
    try { await runJackpotAutoSync(); } catch (err) { console.error("[cron] jackpotAutoSync error:", err.message); }
  });

  console.log(
    "[cron] scheduler started — API-Sports: fixture sync only @ 02:00/13:00/17:00 | football-data: 12 free leagues, fixtures+live every 1min, standings every 20min | ESPN: all live football, every 20s (unmetered)"
  );
}

module.exports = { startScheduler };
