/**
 * Every jackpot platform runs its own product line — different names,
 * different game counts, different cadence. This is descriptive metadata
 * (used to validate an ingest payload and to label things sensibly in
 * the UI), NOT a hard schema constraint — a platform can and does change
 * its own format without warning, so `ingestJackpot` only WARNS on a
 * mismatch rather than rejecting the payload outright.
 *
 * Game counts below are the commonly published figures as of this
 * writing; treat them as a sanity-check default, not a guarantee —
 * verify against the platform's current jackpot page before relying on
 * this for anything stricter than a warning log.
 */
const JACKPOT_PLATFORMS = {
  SPORTPESA: {
    label: "SportPesa",
    types: {
      MEGA: { games: 17, cadence: "weekly (Sat/Sun)" },
      MIDWEEK: { games: 13, cadence: "midweek" },
    },
  },
  BETIKA: {
    label: "Betika",
    types: {
      GRAND: { games: 15, cadence: "weekly (Sat/Sun)" },
      MIDWEEK: { games: 15, cadence: "midweek" }, // e.g. "15M Midweek Jackpot" — confirmed via api.betika.com/v1/jackpot/events, 2026-07-29
      SABABISHA: { games: 15, cadence: "midweek/weekly" },
    },
  },
  MOZZART: {
    label: "Mozzart Bet",
    types: {
      GRAND: { games: 16, cadence: "weekly" }, // "Super Grand Jackpot"
      MIDWEEK: { games: 15, cadence: "midweek" },
      DAILY: { games: 10, cadence: "daily" },
    },
  },
  SHABIKI: {
    label: "Shabiki",
    types: {
      WEEKLY: { games: 15, cadence: "weekly" },
      DAILY: { games: 10, cadence: "daily" },
    },
  },
};

/** How many past jackpots to keep surfaced per platform+type combo. */
const HISTORY_RETENTION = 5;

function expectedGameCount(platform, type) {
  return JACKPOT_PLATFORMS[platform]?.types?.[type]?.games ?? null;
}

function isKnownCombo(platform, type) {
  return Boolean(JACKPOT_PLATFORMS[platform]?.types?.[type]);
}

function platformLabel(platform) {
  return JACKPOT_PLATFORMS[platform]?.label ?? platform;
}

module.exports = { JACKPOT_PLATFORMS, HISTORY_RETENTION, expectedGameCount, isKnownCombo, platformLabel };
