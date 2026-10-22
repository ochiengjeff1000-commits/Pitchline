/**
 * Turns a raw API-Football /fixtures/events timeline into a "momentum" series.
 */

const EVENT_WEIGHTS = {
  Goal: 10,
  "Own Goal": 10,
  Card: 3,
  "Red Card": 7,
  subst: 1,
  Var: 4,
};

const DECAY_HALF_LIFE_MINUTES = 12;

function eventWeight(event) {
  let typeKey = event.type;
  if (event.type === "Card" && event.detail && event.detail.includes("Red Card")) {
    typeKey = "Red Card";
  }

  const base = EVENT_WEIGHTS[typeKey] || 1;
  const isAgainstTeam = event.type === "Card" || typeKey === "Red Card" || event.type === "Var";
  return isAgainstTeam ? -base : base;
}

/**
 * @param {Array<{time:{elapsed:number}, team:{id:number}, type:string, detail:string}>} rawEvents
 * @param {number} homeTeamApiId
 * @param {number} currentMinute
 */
function computeMomentum(rawEvents, homeTeamApiId, currentMinute) {
  const timeline = (rawEvents || []).map((e) => ({
    minute: e.time?.elapsed ?? 0,
    extra: e.time?.extra ?? null,
    side: e.team?.id === homeTeamApiId ? "home" : "away",
    type: e.type,
    detail: e.detail,
    player: e.player?.name || null,
  }));

  let score = 0;
  for (const e of timeline) {
    const signed = eventWeight({ type: e.type, detail: e.detail }) * (e.side === "home" ? 1 : -1);
    const minutesAgo = Math.max(currentMinute - e.minute, 0);
    const decay = Math.pow(0.5, minutesAgo / DECAY_HALF_LIFE_MINUTES);
    score += signed * decay;
  }

  const momentum = Math.tanh(score / 15);

  return { momentum: Math.round(momentum * 100) / 100, timeline };
}

module.exports = { computeMomentum };