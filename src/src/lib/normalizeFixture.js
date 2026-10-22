/**
 * Football (v3 "fixtures") returns a structurally different payload from
 * every other API-Sports v1 product ("games" — Basketball, Hockey,
 * Baseball, Handball, Volleyball, Rugby, AFL, NFL). This normalizes all
 * of them into one shape the rest of the codebase can use without caring
 * which sport it is.
 */
function normalizeFixture(sport, item) {
  if (sport === "FOOTBALL") {
    return {
      apiId: item.fixture.id,
      kickoff: item.fixture.date,
      statusShort: item.fixture.status.short,
      elapsed: item.fixture.status.elapsed ?? null,
      league: {
        apiId: item.league.id,
        name: item.league.name,
        country: item.league.country,
        logo: item.league.logo,
      },
      homeTeam: { apiId: item.teams.home.id, name: item.teams.home.name, logo: item.teams.home.logo },
      awayTeam: { apiId: item.teams.away.id, name: item.teams.away.name, logo: item.teams.away.logo },
      homeScore: item.goals?.home ?? null,
      awayScore: item.goals?.away ?? null,
      periodLabel: null, // football already communicates period via FixtureStatus (HALFTIME/LIVE) + elapsed minutes
    };
  }

  // Generic v1 "games" shape — BASKETBALL / HOCKEY / BASEBALL / HANDBALL /
  // VOLLEYBALL / RUGBY / AFL / NFL
  return {
    apiId: item.id,
    kickoff: item.date,
    statusShort: item.status?.short,
    elapsed: item.status?.timer ?? item.status?.elapsed ?? null,
    league: {
      apiId: item.league.id,
      name: item.league.name,
      country: item.country?.name || item.league.country || "Unknown",
      logo: item.league.logo,
    },
    homeTeam: { apiId: item.teams.home.id, name: item.teams.home.name, logo: item.teams.home.logo },
    awayTeam: { apiId: item.teams.away.id, name: item.teams.away.name, logo: item.teams.away.logo },
    homeScore: item.scores?.home?.total ?? null,
    awayScore: item.scores?.away?.total ?? null,
    // API-Sports' v1 "games" products give a human-readable period string
    // here (e.g. "Quarter 3", "2nd Period", "1st Inning") — this is what
    // makes the live badge accurate for these sports; `elapsed` above is
    // often just a countdown WITHIN that period, not total match minutes,
    // so displaying it alone (football-style, "67'") would be misleading.
    periodLabel: item.status?.long || item.status?.short || null,
  };
}

module.exports = { normalizeFixture };