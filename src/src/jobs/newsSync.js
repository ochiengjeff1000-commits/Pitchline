const prisma = require("../lib/prisma");
const { fetchAndCacheNews } = require("../services/newsAggregator");

/** Runs every 2 hours (see scheduler.js). No API-Sports quota involved — RSS is free and unmetered. */
async function runNewsSync() {
  let status = "success";
  let errorMessage = null;
  let stored = 0;

  try {
    const result = await fetchAndCacheNews();
    stored = result.stored;
    if (result.errors.length > 0) {
      status = "partial";
      errorMessage = result.errors.join("; ");
    }
  } catch (err) {
    status = "failed";
    errorMessage = err.message;
    console.error("[newsSync] failed:", err);
  }

  await prisma.syncLog.create({
    data: { jobName: "newsSync", apiCallsUsed: 0, fixturesIn: 0, predictionsOut: stored, status, errorMessage },
  });

  console.log(`[newsSync] stored=${stored} status=${status}`);
}

module.exports = { runNewsSync };
