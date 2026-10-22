/**
 * Single source of truth for "clean" team-name comparison across every
 * provider boundary (ESPN <-> API-Sports <-> football-data.org) and
 * every fuzzy-match consumer (livePollingJob, espnClient, jackpotIngestion).
 * Previously each of those files carried its own slightly different copy
 * of this function, so a name that matched in one place could silently
 * fail to match in another.
 *
 * Strips common club-name suffixes/prefixes ("FC", "United", "City", etc.),
 * special characters, and casing, so e.g. "Man United" / "Manchester Utd" /
 * "Manchester United FC" all collapse to a comparable core string.
 */
const NOISE_WORDS = [
  "fc", "cf", "sc", "ac", "cd", "ud", "sv", "vfb", "rb", "afc", "ssd", "ssc",
  "club", "athletic", "atletico", "atletic", "real", "sporting", "calcio",
  "united", "utd", "city", "town", "county", "rovers", "wanderers",
  "albion", "hotspur", "rotterdam",
];

const NOISE_REGEX = new RegExp(`\\b(${NOISE_WORDS.join("|")})\\b`, "gi");

function normalizeTeamName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(NOISE_REGEX, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** True if either normalized name contains the other — tolerant enough for
 * cross-provider abbreviations ("Man Utd" vs "Manchester United") while
 * still requiring a real substring relationship, not just a shared letter. */
function teamNamesMatch(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

module.exports = { normalizeTeamName, teamNamesMatch };
