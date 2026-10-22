const TIER_1 = new Set([
  2,   // UEFA Champions League
  39,  // Premier League
  140, // La Liga
  135, // Serie A
  78,  // Bundesliga
]);

const TIER_2 = new Set([
  61,  // Ligue 1
  3,   // UEFA Europa League
  88,  // Eredivisie
  253, // MLS
  307, // Saudi Pro League
  40,  // Championship (England)
  848, // UEFA Conference League
]);

const TIER_4 = new Set([]);

function tierForLeagueId(apiLeagueId) {
  if (TIER_1.has(apiLeagueId)) return "TIER_1";
  if (TIER_2.has(apiLeagueId)) return "TIER_2";
  if (TIER_4.has(apiLeagueId)) return "TIER_4";
  return "TIER_3";
}

const TIER_1_NAMES = [
  /nba/i,
  /euroleague/i,
  /nhl/i,
  /khl/i,
  /\bnfl\b/i,
  /\bmlb\b/i,
  /six nations/i,
  /rugby championship/i,
  /\bafl\b/i,
  /premiership rugby/i,
];

const TIER_2_NAMES = [
  /wnba/i,
  /eurocup/i,
  /ahl/i,
  /liiga/i,
  /shl/i,
  /champions cup/i,
  /world championship/i,
  /nations league/i,
];

function tierForLeague(apiLeagueId, sport, name = "") {
  if (sport === "FOOTBALL") return tierForLeagueId(apiLeagueId);

  if (TIER_1_NAMES.some((re) => re.test(name))) return "TIER_1";
  if (TIER_2_NAMES.some((re) => re.test(name))) return "TIER_2";
  return "TIER_3";
}

module.exports = { TIER_1, TIER_2, TIER_4, tierForLeagueId, tierForLeague };