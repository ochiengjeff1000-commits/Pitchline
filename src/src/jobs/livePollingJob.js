const prisma = require("../lib/prisma");
const { getLiveScoreboard, mapEspnStatus } = require("../services/espnClient");
const { teamNamesMatch } = require("../lib/teamNameNormalize");

// If a live-matched update didn't include an explicit clock value, keep
// whatever we already had rather than clobbering it with null.
function pickElapsed(newVal, oldVal) {
  return newVal !== null && newVal !== undefined ? newVal : oldVal;
}

/**
 * Provider 1 of the tri-provider live tracker: ESPN's public scoreboard.
 * No request quota, so this is safe to call on a tight 15-30s interval —
 * it's what makes the ticker feel real-time. Matches ESPN events against
 * our own fixtures by (cached espnId first, then) fuzzy team-name match,
 * and caches the espnId on first match so later ticks and the on-demand
 * /insights /stats /lineups routes can skip straight to it.
 */
async function runEspnLiveTick() {
  try {
    const events = await getLiveScoreboard("all");
    if (events.length === 0) return;

    const candidateFixtures = await prisma.fixture.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE", "HALFTIME"] },
        kickoff: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
      },
      include: { homeTeam: true, awayTeam: true },
    });
    if (candidateFixtures.length === 0) return;

    const byEspnId = new Map(candidateFixtures.filter((f) => f.espnId).map((f) => [f.espnId, f]));

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const homeRaw = comp.competitors?.[0]?.team?.displayName || comp.competitors?.[0]?.team?.name;
      const awayRaw = comp.competitors?.[1]?.team?.displayName || comp.competitors?.[1]?.team?.name;
      if (!homeRaw || !awayRaw) continue;

      const homeScore = comp.competitors?.[0]?.score != null ? String(comp.competitors[0].score) : "0";
      const awayScore = comp.competitors?.[1]?.score != null ? String(comp.competitors[1].score) : "0";
      const targetStatus = mapEspnStatus(event.status);
      const clockDisplay = event.status?.displayClock || "";
      const elapsedMin = parseInt(clockDisplay.replace(/[^0-9]/g, ""), 10);
      const elapsed = Number.isFinite(elapsedMin) ? elapsedMin : null;

      // Fast path: we already know this fixture's espnId from a previous tick.
      let match = byEspnId.get(String(event.id));

      // Fallback: fuzzy team-name match against still-unmatched fixtures.
      if (!match) {
        match = candidateFixtures.find(
          (f) => !f.espnId && teamNamesMatch(f.homeTeam.name, homeRaw) && teamNamesMatch(f.awayTeam.name, awayRaw)
        );
      }
      if (!match) continue;

      await prisma.fixture.update({
        where: { id: match.id },
        data: {
          homeScore: Number(homeScore),
          awayScore: Number(awayScore),
          status: targetStatus,
          elapsed: pickElapsed(elapsed, match.elapsed),
          espnId: String(event.id),
        },
      });
    }
  } catch (err) {
    console.error("[livePollingJob] ESPN tick failed:", err.message);
  }
}

/**
 * Auto-Expiration Guard: if a game kicked off >130 minutes ago and is
 * still marked LIVE/HALFTIME, force it to FINISHED. Catches fixtures no
 * provider ever reported a final whistle for (stream drop, name-match
 * miss, etc.) so they don't sit "live" forever.
 */
async function runStuckMatchGuard() {
  try {
    const stuckCutoff = new Date(Date.now() - 130 * 60 * 1000);
    const expired = await prisma.fixture.updateMany({
      where: { status: { in: ["LIVE", "HALFTIME"] }, kickoff: { lte: stuckCutoff } },
      data: { status: "FINISHED" },
    });
    if (expired.count > 0) {
      console.log(`[livePollingJob] Auto-settled ${expired.count} stuck live matches past 130 minutes.`);
    }
  } catch (err) {
    console.error("[livePollingJob] Stuck-match guard failed:", err.message);
  }
}

module.exports = { runEspnLiveTick, runStuckMatchGuard };
