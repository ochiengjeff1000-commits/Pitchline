/* ============ SHARED HELPERS ============ */

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function isoIn(mins) {
  return new Date(Date.now() + mins * 60000).toISOString();
}

export function pickLabel(outcome) {
  return { HOME: "1", DRAW: "X", AWAY: "2" }[outcome] || "—";
}

/**
 * Formats a fixture's live status for display. For football (and other
 * continuous-clock sports), `clockMinute` really is elapsed minutes, so
 * "67'" is accurate. For period-based sports (basketball, hockey, etc),
 * the raw clock value is often a countdown WITHIN the current period —
 * showing it with a "'" suffix would misleadingly imply match-minutes
 * elapsed. `periodLabel` (e.g. "Q3", "2nd Period") is what the backend
 * actually has confirmed for those sports, so prefer it whenever present.
 */
export function formatLiveClock(f) {
  if (f.periodLabel) return f.periodLabel;
  if (f.clockMinute) return `${f.clockMinute}'`;
  return "LIVE";
}

/**
 * Buckets a prediction's confidence (0-1, the top outcome's probability)
 * into a human label + CSS class. Thresholds are calibrated around a
 * football 1X2 baseline (a pure coin-flip across 3 outcomes sits at
 * ~33%), not a generic 50% cutoff — a "tough" football match still often
 * has a top pick in the low 40s.
 */
export function confidenceTier(confidence) {
  const c = confidence ?? 0;
  if (c >= 0.55) return { label: "High Confidence", cls: "conf-high" };
  if (c >= 0.42) return { label: "Moderate", cls: "conf-mid" };
  return { label: "Tough Call", cls: "conf-low" };
}

export function tierIcon(tier) {
  return { TIER_1: "★", TIER_2: "●", TIER_3: "○", TIER_4: "·" }[tier] || "○";
}

export function momentumEventIcon(type) {
  if (type === "Goal" || type === "Own Goal") return "⚽";
  if (type === "Red Card") return "🟥";
  if (type === "Card") return "🟨";
  if (type === "subst") return "🔄";
  if (type === "Var") return "📺";
  return "•";
}

export function playerAvatarUrl(photoId) {
  if (!photoId) return "";
  const cleanId = String(photoId).replace(/\.(jpg|png)$/i, "");
  return `https://resources.premierleague.com/premierleague/photos/players/110x140/p${cleanId}.png`;
}

export function isFixtureLive(f) {
  if (!f) return false;
  const liveStatuses = ["LIVE", "HALFTIME", "HT", "1H", "2H", "ET", "P", "IN_PLAY", "BREAK"];
  return Boolean(f.isLive || liveStatuses.includes(f.status));
}

export function openModal(id) {
  document.getElementById(id).classList.add("open");
}

export function closeModal(id, onMatchCenterClose) {
  document.getElementById(id).classList.remove("open");
  if (id === "matchCenterModal" && typeof onMatchCenterClose === "function") onMatchCenterClose();
}
