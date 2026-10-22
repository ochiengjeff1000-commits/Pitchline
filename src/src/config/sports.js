const SPORTS = {
  FOOTBALL: {
    baseUrl: "https://v3.football.api-sports.io",
    apiKeyEnv: "API_FOOTBALL_KEY",
    fixturesPath: "/fixtures",
    supportsBtts: true,
    supportsDraw: true,
  },
  BASKETBALL: {
    baseUrl: "https://v1.basketball.api-sports.io",
    apiKeyEnv: "API_BASKETBALL_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: false,
  },
  HOCKEY: {
    baseUrl: "https://v1.hockey.api-sports.io",
    apiKeyEnv: "API_HOCKEY_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: false,
  },
  BASEBALL: {
    baseUrl: "https://v1.baseball.api-sports.io",
    apiKeyEnv: "API_BASEBALL_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: false,
  },
  HANDBALL: {
    baseUrl: "https://v1.handball.api-sports.io",
    apiKeyEnv: "API_HANDBALL_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: true,
  },
  VOLLEYBALL: {
    baseUrl: "https://v1.volleyball.api-sports.io",
    apiKeyEnv: "API_VOLLEYBALL_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: false,
  },
  RUGBY: {
    baseUrl: "https://v1.rugby.api-sports.io",
    apiKeyEnv: "API_RUGBY_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: true,
  },
  AFL: {
    baseUrl: "https://v1.afl.api-sports.io",
    apiKeyEnv: "API_AFL_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: true,
  },
  NFL: {
    baseUrl: "https://v1.american-football.api-sports.io",
    apiKeyEnv: "API_NFL_KEY",
    fixturesPath: "/games",
    supportsBtts: false,
    supportsDraw: false,
  },
};

// NOTE on confidence: RUGBY and AFL were added to this list in a prior
// pass. I can't independently confirm API-Sports still ships dedicated
// products for both under these exact hostnames — verify against your
// API-Sports dashboard subscriptions before enabling them in
// ENABLED_SPORTS, since an unsubscribed product will fail auth the same
// way a wrong key would.

function enabledSports() {
  const raw = process.env.ENABLED_SPORTS || "FOOTBALL";
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SPORTS[s]);
}

module.exports = { SPORTS, enabledSports };