const prisma = require("../lib/prisma");
const { getClient } = require("../services/apiSportsClient");
const { mapStatus } = require("../lib/fixtureStatus");
const { normalizeFixture } = require("../lib/normalizeFixture");
const { enabledSports } = require("../config/sports");

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Runs daily at 13:00 (see scheduler.js), across every enabled sport.
 * Re-fetches TODAY's fixtures (1 request per sport) purely to catch
 * things the 02:00 sync couldn't have known yet: a match postponed or
 * cancelled after the morning sync, or a kickoff time that shifted.
 * Doesn't touch predictions — those stay keyed to the original fixture.
 */
async function runPostponementCheck() {
  const date = todayDateString();
  const sports = enabledSports();

  for (const sport of sports) {
    let status = "success";
    let errorMessage = null;
    let fixturesIn = 0;
    let changed = 0;
    let apiCallsUsed = 0;

    try {
      const client = getClient(sport);
      const rawFixtures = await client.getFixturesByDate(date);
      fixturesIn = rawFixtures.length;
      apiCallsUsed = client.getCallCount();

      for (const raw of rawFixtures) {
        const item = normalizeFixture(sport, raw);
        const newStatus = mapStatus(item.statusShort);
        const newKickoff = new Date(item.kickoff);

        const existing = await prisma.fixture.findUnique({
          where: { apiId_sport_provider: { apiId: item.apiId, sport, provider: "API_SPORTS" } },
        });
        if (!existing) continue; // wasn't in our DB (shouldn't normally happen for "today")

        const statusChanged = existing.status !== newStatus;
        const kickoffShifted = existing.kickoff.getTime() !== newKickoff.getTime();
        if (!statusChanged && !kickoffShifted) continue;

        await prisma.fixture.update({
          where: { id: existing.id },
          data: { status: newStatus, kickoff: newKickoff },
        });
        changed += 1;

        if (statusChanged && (newStatus === "POSTPONED" || newStatus === "CANCELLED")) {
          console.log(`[postponementCheck:${sport}] fixture ${existing.id} -> ${newStatus}`);
        }
      }
    } catch (err) {
      status = "failed";
      errorMessage = err.message;
      console.error(`[postponementCheck:${sport}] failed:`, err);
    }

    await prisma.syncLog.create({
      data: {
        jobName: `postponementCheck:${sport}`,
        apiCallsUsed,
        fixturesIn,
        predictionsOut: changed, // reused column: count of records changed this run
        status,
        errorMessage,
      },
    });

    console.log(`[postponementCheck:${sport}] checked=${fixturesIn} changed=${changed} status=${status}`);
  }
}

module.exports = { runPostponementCheck };
