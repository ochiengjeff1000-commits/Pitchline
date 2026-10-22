const prisma = require("../lib/prisma");
const { syncFplData, backfillFinishedGameweekPoints } = require("../services/fplClient");

/** Runs every 6 hours (see scheduler.js). No API-Sports quota involved. */
async function runFplSync() {
  let status = "success";
  let errorMessage = null;
  let playersUpserted = 0;

  try {
    const result = await syncFplData();
    playersUpserted = result.playersUpserted;
    console.log(
      `[fplSync] players=${result.playersUpserted} fixtures=${result.fixturesUpserted} gameweeks=${result.gameweeksUpserted} current=${result.currentGameweek}`
    );

    const pointsSynced = await backfillFinishedGameweekPoints();
    if (pointsSynced > 0) console.log(`[fplSync] backfilled real points for ${pointsSynced} finished gameweek(s)`);
  } catch (err) {
    status = "failed";
    errorMessage = err.message;
    console.error("[fplSync] failed:", err);
  }

  await prisma.syncLog.create({
    data: { jobName: "fplSync", apiCallsUsed: 0, fixturesIn: 0, predictionsOut: playersUpserted, status, errorMessage },
  });
}

module.exports = { runFplSync };
