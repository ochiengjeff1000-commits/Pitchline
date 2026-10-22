import { isoIn } from "./utils.js";

/* Local-dev-only sample data — see state.DEMO_MODE. Never shown to a
   real visitor hitting a deployed backend; this exists purely so the
   UI has something to render when you open index.html without the
   API running. */

export const DEMO_LEAGUES = [
  { id: 1, sport: "FOOTBALL", name: "UEFA Champions League", country: "World", tier: "TIER_1", fixtures: [
    { id: 101, kickoff: isoIn(-45), status: "HT", isLive: true, clockMinute: 45, homeTeam: { name: "Arsenal", logoUrl: "https://media.api-sports.io/football/teams/42.png" }, awayTeam: { name: "Real Madrid", logoUrl: "https://media.api-sports.io/football/teams/541.png" }, homeScore: 1, awayScore: 0, prediction: { predictedOutcome: "HOME", predictedBtts: true, confidence: 0.58, probHome: 0.58, probDraw: 0.22, probAway: 0.20 } },
    { id: 102, kickoff: isoIn(180), status: "SCHEDULED", isLive: false, homeTeam: { name: "Bayern Munich", logoUrl: "https://media.api-sports.io/football/teams/157.png" }, awayTeam: { name: "Inter Milan", logoUrl: "https://media.api-sports.io/football/teams/505.png" }, homeScore: null, awayScore: null, prediction: { predictedOutcome: "HOME", predictedBtts: false, confidence: 0.61, probHome: 0.61, probDraw: 0.24, probAway: 0.15 } },
  ] },
  { id: 2, sport: "FOOTBALL", name: "Premier League", country: "England", tier: "TIER_1", fixtures: [
    { id: 103, kickoff: isoIn(-60), status: "2H", isLive: true, clockMinute: 60, homeTeam: { name: "Manchester City", logoUrl: "https://media.api-sports.io/football/teams/50.png" }, awayTeam: { name: "Liverpool", logoUrl: "https://media.api-sports.io/football/teams/40.png" }, homeScore: 1, awayScore: 1, prediction: { predictedOutcome: "DRAW", predictedBtts: true, confidence: 0.42, probHome: 0.38, probDraw: 0.42, probAway: 0.20 } },
    { id: 104, kickoff: isoIn(300), status: "SCHEDULED", isLive: false, homeTeam: { name: "Manchester United", logoUrl: "https://media.api-sports.io/football/teams/33.png" }, awayTeam: { name: "Chelsea", logoUrl: "https://media.api-sports.io/football/teams/49.png" }, homeScore: null, awayScore: null, prediction: { predictedOutcome: "DRAW", predictedBtts: true, confidence: 0.34, probHome: 0.33, probDraw: 0.34, probAway: 0.33 } },
  ] },
  { id: 3, sport: "FOOTBALL", name: "Kenyan Premier League", country: "Kenya", tier: "TIER_3", fixtures: [
    { id: 105, kickoff: isoIn(-120), status: "FT", isLive: false, clockMinute: 90, homeTeam: { name: "Gor Mahia", logoUrl: "" }, awayTeam: { name: "AFC Leopards", logoUrl: "" }, homeScore: 2, awayScore: 0, prediction: { predictedOutcome: "HOME", predictedBtts: false, confidence: 0.65, probHome: 0.65, probDraw: 0.20, probAway: 0.15 } },
  ] },
  { id: 4, sport: "BASKETBALL", name: "NBA", country: "USA", tier: "TIER_1", fixtures: [
    { id: 106, kickoff: isoIn(90), status: "SCHEDULED", isLive: false, homeTeam: { name: "Lakers", logoUrl: "" }, awayTeam: { name: "Celtics", logoUrl: "" }, homeScore: null, awayScore: null, prediction: { predictedOutcome: "AWAY", confidence: 0.57, probHome: 0.43, probDraw: 0.0, probAway: 0.57 } },
  ] },
];

export const DEMO_STATS = { winRate1x2: 58.2, winRateBtts: 61.4, totalSettled: 214 };

export const DEMO_JACKPOTS = [
  { id: 1, platform: "SPORTPESA", platformLabel: "SportPesa", type: "MEGA", label: "SportPesa Mega Jackpot — Week 30", status: "OPEN", totalGames: 17, selectionsLoaded: 17, correctCount: null, settledAt: null },
  { id: 2, platform: "BETIKA", platformLabel: "Betika", type: "MIDWEEK", label: "Betika Midweek Jackpot", status: "OPEN", totalGames: 15, selectionsLoaded: 15, correctCount: null, settledAt: null },
  { id: 3, platform: "MOZZART", platformLabel: "Mozzart Bet", type: "GRAND", label: "Mozzart Grand Jackpot", status: "OPEN", totalGames: 17, selectionsLoaded: 17, correctCount: null, settledAt: null },
  { id: 4, platform: "SHABIKI", platformLabel: "Shabiki", type: "WEEKLY", label: "Shabiki Weekly Jackpot", status: "OPEN", totalGames: 15, selectionsLoaded: 15, correctCount: null, settledAt: null },
];

export const DEMO_SPORTS = ["FOOTBALL", "BASKETBALL", "NBA", "HOCKEY", "BASEBALL", "HANDBALL", "VOLLEYBALL", "RUGBY", "AFL", "NFL", "FORMULA1", "MMA"];

export const DEMO_NEWS = [
  { id: 1, title: "Transfer window: five deals to watch before deadline day", source: "BBC Sport", url: "#", imageUrl: null, publishedAt: isoIn(-120) },
  { id: 2, title: "Weekend preview: title race tightens after midweek results", source: "Sky Sports", url: "#", imageUrl: null, publishedAt: isoIn(-300) },
];

export const DEMO_FPL_SQUAD = {
  gameweek: 1, totalXPts: 62.4, totalCostTenths: 987, totalPointsEarned: null,
  deadlineTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), finished: false,
  formation: "3-4-3",
  explanation: "Demo squad: leans on in-form premium midfielders with a soft run of fixtures over the next three gameweeks, balanced by a cheap enabler defence to free up budget for the front three.",
  squad: [
    { fplPlayerId: 1, name: "Demo Keeper", teamName: "Arsenal", position: "GKP", priceTenths: 50, photoId: "", isStarting: true, isCaptain: false, isVice: false, xPts: 4.2, opponent: "Everton", isHome: true, justification: "Form 4.1, £5.0m. Favourable fixture run." },
    { fplPlayerId: 2, name: "Demo Defender A", teamName: "Liverpool", position: "DEF", priceTenths: 55, photoId: "", isStarting: true, isCaptain: false, isVice: false, xPts: 5.1, opponent: "Brentford", isHome: false, justification: "Form 5.0, £5.5m. Favourable fixture run." },
    { fplPlayerId: 3, name: "Demo Midfielder A", teamName: "Man City", position: "MID", priceTenths: 105, photoId: "", isStarting: true, isCaptain: true, isVice: false, xPts: 9.8, opponent: "Fulham", isHome: true, justification: "Form 8.2, £10.5m. Captain pick." },
    { fplPlayerId: 4, name: "Demo Forward A", teamName: "Chelsea", position: "FWD", priceTenths: 85, photoId: "", isStarting: true, isCaptain: false, isVice: true, xPts: 8.1, opponent: null, isHome: null, justification: "Form 7.5, £8.5m. Vice captain. Blank gameweek — no fixture." },
  ],
};
