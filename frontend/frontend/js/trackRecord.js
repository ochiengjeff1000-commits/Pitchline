import { api } from "./api.js";
import { esc, pickLabel } from "./utils.js";

/* ============ BEST BET OF THE DAY ============ */

function bestBetCard(bet, kind) {
  const kickoff = new Date(bet.kickoff);
  const timeStr = kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const scoreStr = bet.predictedScore ? ` · Predicted ${bet.predictedScore.home}-${bet.predictedScore.away}` : "";
  return `
    <div class="best-bet-alt" data-open-match="${bet.fixtureId}">
      <div class="bb-alt-teams">${esc(bet.homeTeam)} vs ${esc(bet.awayTeam)}</div>
      <div class="bb-alt-meta">${esc(bet.league)} · ${timeStr}</div>
      <div class="bb-alt-pick">${pickLabel(bet.predictedOutcome)} <span class="bb-alt-conf">${Math.round(bet.confidence * 100)}%</span></div>
    </div>`;
}

export async function loadBestBet() {
  const el = document.getElementById("bestBetBanner");
  if (!el) return;

  const data = await api("/api/predictions/best-bet");
  if (!data || !data.bestBet) {
    el.innerHTML = "";
    return;
  }

  const bet = data.bestBet;
  const kickoff = new Date(bet.kickoff);
  const timeStr = kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = kickoff.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });
  const scoreStr = bet.predictedScore ? `<div class="bb-score">Predicted score: <b>${bet.predictedScore.home} - ${bet.predictedScore.away}</b></div>` : "";

  el.innerHTML = `
    <div class="best-bet-banner">
      <div class="bb-header">
        <span class="bb-label">⭐ Best Bet of the Day</span>
        <span class="bb-conf">${Math.round(bet.confidence * 100)}% confidence</span>
      </div>
      <div class="bb-main" data-open-match="${bet.fixtureId}">
        <div class="bb-meta">${esc(bet.league)}${bet.country ? " · " + esc(bet.country) : ""} · ${dateStr}, ${timeStr}</div>
        <div class="bb-teams">
          <span class="bb-team">${bet.homeLogo ? `<img src="${esc(bet.homeLogo)}" class="team-logo" onerror="this.style.display='none'">` : ""}${esc(bet.homeTeam)}</span>
          <span class="bb-vs">vs</span>
          <span class="bb-team">${bet.awayLogo ? `<img src="${esc(bet.awayLogo)}" class="team-logo" onerror="this.style.display='none'">` : ""}${esc(bet.awayTeam)}</span>
        </div>
        <div class="bb-pick-row">
          <span class="pick-chip bb-pick-chip">${pickLabel(bet.predictedOutcome)}</span>
          ${scoreStr}
        </div>
        ${bet.justification ? `<div class="bb-justification">${esc(bet.justification)}</div>` : ""}
      </div>
      ${data.alternates.length > 0 ? `
        <div class="bb-alternates">
          <div class="bb-alt-label">Also fancied today</div>
          <div class="bb-alt-grid">${data.alternates.map((b) => bestBetCard(b)).join("")}</div>
        </div>` : ""}
    </div>`;
}

/* ============ TRACK RECORD / ACCURACY TAB ============ */

function statCard(label, value, sub) {
  return `
    <div class="acc-stat-card">
      <div class="acc-stat-value">${value}</div>
      <div class="acc-stat-label">${esc(label)}</div>
      ${sub ? `<div class="acc-stat-sub">${esc(sub)}</div>` : ""}
    </div>`;
}

function renderSummary(report) {
  const el = document.getElementById("accuracySummary");
  const w = report.window;
  el.innerHTML = `
    ${statCard("1X2 win rate", w.winRate1x2 != null ? `${w.winRate1x2}%` : "—", `${w.correct1x2}/${w.totalSettled} correct, last ${report.windowDays}d`)}
    ${statCard("BTTS win rate", w.winRateBtts != null ? `${w.winRateBtts}%` : "—", `${w.correctBtts}/${w.totalBttsSettled} correct, last ${report.windowDays}d`)}
    ${statCard("All-time 1X2", report.allTime.winRate1x2 != null ? `${report.allTime.winRate1x2}%` : "—", `${report.allTime.totalSettled} predictions graded`)}
  `;
}

function renderConfidence(report) {
  const el = document.getElementById("accuracyConfidence");
  const rows = report.byConfidence
    .filter((t) => t.totalSettled > 0)
    .map((t) => `
      <div class="acc-bar-row">
        <span class="acc-bar-label">${esc(t.label)}</span>
        <div class="acc-bar-track"><div class="acc-bar-fill" style="width:${t.winRate}%"></div></div>
        <span class="acc-bar-value">${t.winRate}% <span class="acc-bar-n">(${t.correct}/${t.totalSettled})</span></span>
      </div>`).join("");
  el.innerHTML = rows || `<div class="empty-state">Not enough graded predictions yet in this window.</div>`;
}

function renderLeagues(report) {
  const el = document.getElementById("accuracyLeagues");
  if (report.byLeague.length === 0) {
    el.innerHTML = `<div class="empty-state">Not enough graded predictions per league yet in this window.</div>`;
    return;
  }
  el.innerHTML = `
    <table class="acc-table">
      <thead><tr><th>League</th><th>Sample</th><th>Win rate</th></tr></thead>
      <tbody>
        ${report.byLeague.map((l) => `
          <tr>
            <td>${esc(l.leagueName)}</td>
            <td class="mono">${l.correct}/${l.totalSettled}</td>
            <td class="mono acc-rate">${l.winRate}%</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function renderTips(report) {
  const el = document.getElementById("accuracyTips");
  if (report.recentTips.length === 0) {
    el.innerHTML = `<div class="empty-state">No graded predictions yet.</div>`;
    return;
  }
  el.innerHTML = report.recentTips.map((t) => `
    <div class="acc-tip-row">
      <div class="acc-tip-teams">
        <div class="teams">${esc(t.homeTeam)} vs ${esc(t.awayTeam)}</div>
        <div class="meta">${esc(t.league)} · ${new Date(t.kickoff).toLocaleDateString([], { day: "2-digit", month: "short" })}</div>
      </div>
      <div class="acc-tip-pick">Picked: <b>${pickLabel(t.predictedOutcome)}</b>${t.finalScore ? ` · Final: <b>${t.finalScore}</b>` : ""}</div>
      <span class="settle-badge ${t.isCorrect ? "won" : "lost"}">${t.isCorrect ? "WON" : "LOST"}</span>
    </div>`).join("");
}

export async function loadAccuracy(days = 30) {
  const report = await api(`/api/stats/accuracy?days=${days}`);
  if (!report) {
    document.getElementById("accuracySummary").innerHTML = `<div class="empty-state">Couldn't load the track record right now.</div>`;
    return;
  }
  renderSummary(report);
  renderConfidence(report);
  renderLeagues(report);
  renderTips(report);
}
