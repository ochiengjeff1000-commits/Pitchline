const prisma = require("../lib/prisma");
const { getClient } = require("../services/apiSportsClient");
const { mapStatus } = require("../lib/fixtureStatus");
const { normalizeFixture } = require("../lib/normalizeFixture");
const { enabledSports } = require("../config/sports");

const BATCH_SIZE = 20; // API-Sports' max ids-per-request

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Football has an unmetered, continuous live source (ESPN's ticker, every
 * 20s). Every OTHER enabled sport doesn't — ESPN's integration in this
 * codebase is soccer-only, so basketball/hockey/etc previously only got
 * refreshed once every 30 minutes, as a side effect of settlementJob.
 * This closes that gap: runs every 5 minutes, one dormancy-gated check
 * per sport (zero API calls for a sport with nothing live or about to
 * kick off), batching up to 20 fixture ids per call. Each sport has its
 * own separate 100/day API-Sports quota, so this never touches football's
 * budget, and typically only a handful of games are live for a given
 * sport at once — comfortably inside quota even at this cadence.
 *
 * This only touches status/score/elapsed — it does NOT settle
 * predictions or jackpots (that's still settlementJob, every 30 min);
 * this just keeps the live view honest in between.
 */
async function runNonFootballLiveTick() {
  const sports = enabledSports().filter((s) => s !== "FOOTBALL");
  if (sports.length === 0) return;

  const activeWindowStart = new Date(Date.now() - 10 * 60 * 1000);
  const activeWindowEnd = new Date(Date.now() + 10 * 60 * 1000);

  for (const sport of sports) {
    try {
      const pending = await prisma.fixture.findMany({
        where: {
          sport,
          provider: "API_SPORTS",
          OR: [
            { status: "LIVE" },
            { status: "HALFTIME" },
            { status: "SCHEDULED", kickoff: { gte: activeWindowStart, lte: activeWindowEnd } },
          ],
        },
      });

      if (pending.length === 0) continue; // dormant — zero API calls for this sport

      const client = getClient(sport);
      const byApiId = new Map(pending.map((f) => [f.apiId, f]));
      const batches = chunk(pending.map((f) => f.apiId), BATCH_SIZE);
      let updated = 0;

      for (const batch of batches) {
        const rawResults = await client.getFixturesByIds(batch);
        for (const raw of rawResults) {
          const item = normalizeFixture(sport, raw);
          const local = byApiId.get(item.apiId);
          if (!local) continue;

          const parsedElapsed =
            item.elapsed !== null && item.elapsed !== undefined && item.elapsed !== "" && !isNaN(item.elapsed)
              ? parseInt(String(item.elapsed), 10)
              : null;

          await prisma.fixture.update({
            where: { id: local.id },
            data: {
              status: mapStatus(item.statusShort),
              homeScore: item.homeScore,
              awayScore: item.awayScore,
              elapsed: parsedElapsed,
              periodLabel: item.periodLabel,
            },
          });
          updated += 1;
        }
      }

      if (updated > 0) console.log(`[nonFootballLiveTick:${sport}] updated ${updated} fixture(s)`);
    } catch (err) {
      console.error(`[nonFootballLiveTick:${sport}] failed:`, err.message);
    }
  }
}

module.exports = { runNonFootballLiveTick };
