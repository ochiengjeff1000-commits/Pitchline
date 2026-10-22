const prisma = require("../lib/prisma");
const { generateSquadRecommendation } = require("../services/squadOptimizer");

async function currentGameweek() {
  const upcomingFixture = await prisma.fplFixture.findFirst({
    where: { kickoff: { gte: new Date() } },
    orderBy: { gameweek: "asc" },
  });
  if (upcomingFixture) return upcomingFixture.gameweek;

  const latestFixture = await prisma.fplFixture.findFirst({
    orderBy: { gameweek: "desc" },
  });
  return latestFixture?.gameweek || 1;
}

/** Runs weekly (see scheduler.js), after fplSync has refreshed the pool[cite: 21]. */
async function runFplSquadGen() {
  let status = "success";
  let errorMessage = null;
  let gameweek = null;

  try {
    gameweek = await currentGameweek();
    await generateSquadRecommendation(gameweek);
    console.log(`[fplSquadGen] generated squad for GW${gameweek}`);
  } catch (err) {
    status = "failed";
    errorMessage = err.message;
    console.error("[fplSquadGen] failed:", err);
  }

  await prisma.syncLog.create({
    data: { jobName: "fplSquadGen", apiCallsUsed: 0, fixturesIn: 0, predictionsOut: gameweek || 0, status, errorMessage },
  });
}

module.exports = { runFplSquadGen, currentGameweek };