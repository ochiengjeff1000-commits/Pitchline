const { ADAPTERS } = require("../services/jackpotSources");
const { ingestJackpot } = require("../services/jackpotIngestion");

/**
 * Runs every configured jackpot source adapter and ingests whatever comes
 * back. Predictions are generated automatically as part of ingestJackpot
 * (it backfills a prediction for every matched fixture that doesn't
 * already have one) — so "the list updates itself, then does the
 * predictions" happens in one pass here, for every adapter that's wired
 * up. Anything an adapter returns lands in NEEDS_REVIEW, not straight to
 * the public jackpot list — see /admin/jackpots/pending and
 * /admin/jackpots/:id/approve.
 *
 * Adapters with no endpoint configured just return [] (see each file in
 * src/services/jackpotSources/) — this job is safe to leave scheduled
 * indefinitely even before any of the four platforms are wired up.
 */
async function runJackpotAutoSync() {
  let totalIngested = 0;
  let totalMatched = 0;
  let totalAutoCreated = 0;

  for (const adapter of ADAPTERS) {
    try {
      const pools = await adapter.fetchCurrentJackpots();
      if (pools.length === 0) continue;

      for (const pool of pools) {
        const result = await ingestJackpot({ ...pool, initialStatus: "NEEDS_REVIEW" });
        totalIngested += 1;
        totalMatched += result.matchedCount;
        totalAutoCreated += result.autoCreatedCount;
        console.log(
          `[jackpotAutoSync:${adapter.platform}] ingested "${pool.label}" — ${result.matchedCount}/${pool.games.length} games analyzed (${result.autoCreatedCount} auto-created, no pre-existing fixture needed), awaiting review (jackpot #${result.jackpotId})`
        );
      }
    } catch (err) {
      console.error(`[jackpotAutoSync:${adapter.platform}] failed:`, err.message);
    }
  }

  if (totalIngested > 0) {
    console.log(`[jackpotAutoSync] done — ${totalIngested} jackpot(s) ingested, ${totalMatched} games analyzed, ${totalAutoCreated} auto-created, all pending review`);
  }
}

module.exports = { runJackpotAutoSync };