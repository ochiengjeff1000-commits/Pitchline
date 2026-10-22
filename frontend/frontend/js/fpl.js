import { api, demoFallback } from "./api.js";
import { esc, openModal, playerAvatarUrl } from "./utils.js";
import { DEMO_FPL_SQUAD } from "./demoData.js";

function formatDeadline(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function opponentLine(p) {
  if (!p.opponent) return `<div class="p-opponent p-opponent-blank">No fixture this GW</div>`;
  const venue = p.isHome ? "H" : "A";
  return `<div class="p-opponent">${p.isHome ? "vs" : "@"} ${esc(p.opponent)} <span class="venue-tag venue-${venue.toLowerCase()}">${venue}</span></div>`;
}

function playerCard(p) {
  const cls = p.isCaptain ? "captain" : p.isVice ? "vice" : "";
  const badge = p.isCaptain ? "C" : p.isVice ? "V" : "";
  const avatar = p.photoUrl || playerAvatarUrl(p.photoId);

  // The onerror handler swaps the <img> for a placeholder div on load
  // failure. It must never contain a literal double-quote (it sits inside
  // a double-quoted HTML attribute) — kept to single-quoted JS only.
  const placeholder = `<div class='avatar-placeholder'>👤</div>`;
  const escapedPlaceholder = placeholder.replace(/'/g, "\\'");
  const onerror = `this.outerHTML='${escapedPlaceholder}';`;

  const pointsBadge = p.actualPoints != null
    ? `<div class="p-points">${p.actualPoints}${p.fplPlayerId === p.doubledId ? "×2" : ""} pts</div>`
    : "";

  return `
    <div class="player-card ${cls}" data-open-fpl-player='${esc(JSON.stringify(p))}'>
      <div class="avatar-wrap">
        ${avatar ? `<img src="${avatar}" alt="${esc(p.name)}" loading="lazy" onerror="${onerror}">` : placeholder}
        ${badge ? `<span class="badge">${badge}</span>` : ""}
      </div>
      <div class="pname">${esc(p.name)}</div>
      <div class="pprice">£${(p.priceTenths / 10).toFixed(1)}m</div>
      ${opponentLine(p)}
      ${pointsBadge}
    </div>`;
}

/** Renders the row of clickable gameweek pills — current one highlighted, past ones show their final points once settled. */
function gwTabsHtml(gameweeks, activeGw) {
  if (!gameweeks || gameweeks.length === 0) return "";
  return gameweeks
    .map((g) => {
      const active = g.gameweek === activeGw ? "active" : "";
      const scoreTag = g.totalPointsEarned != null ? `<span class="gw-tab-score">${g.totalPointsEarned}pts</span>` : "";
      return `<button class="gw-tab ${active}" data-fpl-gw="${g.gameweek}">GW${g.gameweek}${scoreTag}</button>`;
    })
    .join("");
}

function deadlineBarHtml(data) {
  if (data.finished) {
    return `<div class="fpl-deadline-bar fpl-deadline-finished">Gameweek ${data.gameweek} finished${data.totalPointsEarned != null ? ` — final score ${data.totalPointsEarned} pts` : ""}</div>`;
  }
  const formatted = formatDeadline(data.deadlineTime);
  if (!formatted) return "";
  return `<div class="fpl-deadline-bar">⏰ GW${data.gameweek} deadline: <b>${formatted}</b></div>`;
}

/** The "why this XI" section below the pitch — squad-level rationale plus every starter's individual justification. */
function analysisSectionHtml(data, starters, bench) {
  const rows = [...starters, ...bench]
    .map(
      (p) => `
        <div class="analysis-row">
          <div class="analysis-row-head">
            <b>${esc(p.name)}</b>
            <span class="analysis-tag">${esc(p.position)}${p.isCaptain ? " · Captain" : p.isVice ? " · Vice-Captain" : p.isStarting ? "" : " · Bench"}</span>
          </div>
          <p>${esc(p.justification || "")}</p>
        </div>`
    )
    .join("");

  return `
    <div class="fpl-analysis">
      <h3>Squad Analysis</h3>
      ${data.explanation ? `<p class="fpl-analysis-summary">${esc(data.explanation)}</p>` : ""}
      <div class="analysis-list">${rows}</div>
    </div>`;
}

export async function loadFplSquad(gameweek) {
  const query = gameweek ? `?gameweek=${gameweek}` : "";
  const data = (await api(`/api/fpl/squad${query}`)) ?? demoFallback(DEMO_FPL_SQUAD);
  const gameweeks = await api("/api/fpl/gameweeks");

  const wrap = document.getElementById("fplSquadWrap");
  const deadlineBar = document.getElementById("fplDeadlineBar");
  const gwTabs = document.getElementById("fplGwTabs");

  if (!data) {
    document.getElementById("fplGwLabel").textContent = "GW —";
    deadlineBar.innerHTML = "";
    gwTabs.innerHTML = "";
    wrap.innerHTML = `<div class="empty-state">FPL squad recommendation isn't ready yet — check back after the next sync.</div>`;
    return;
  }

  document.getElementById("fplGwLabel").textContent = "GW " + data.gameweek;
  deadlineBar.innerHTML = deadlineBarHtml(data);
  gwTabs.innerHTML = gwTabsHtml(gameweeks, data.gameweek);

  const doubledId = (() => {
    const cap = data.squad.find((p) => p.isCaptain && p.isStarting);
    const vice = data.squad.find((p) => p.isVice && p.isStarting);
    if (!cap) return null;
    return cap.minutesPlayed > 0 || cap.minutesPlayed == null ? cap.fplPlayerId : vice?.fplPlayerId;
  })();
  const squadWithDoubled = data.squad.map((p) => ({ ...p, doubledId }));

  const starters = squadWithDoubled.filter((p) => p.isStarting);
  const bench = squadWithDoubled.filter((p) => !p.isStarting);
  const byPos = (pos) => starters.filter((p) => p.position === pos);
  const pitchRow = (pos) => {
    const players = byPos(pos);
    return `<div class="pitch-row" style="grid-template-columns:repeat(${players.length || 1},1fr);">${players.map(playerCard).join("")}</div>`;
  };

  const captain = starters.find((p) => p.isCaptain);
  const vice = starters.find((p) => p.isVice);
  const hasEarnedPoints = data.totalPointsEarned != null;

  wrap.innerHTML = `
    <div class="fpl-summary">
      <div class="fpl-stat"><div class="v">${hasEarnedPoints ? data.totalPointsEarned : data.totalXPts}</div><div class="l">${hasEarnedPoints ? "Points earned" : "Projected xPts"}</div></div>
      <div class="fpl-stat"><div class="v">£${(data.totalCostTenths / 10).toFixed(1)}m</div><div class="l">Squad cost</div></div>
      <div class="fpl-stat"><div class="v">${starters.length}/11</div><div class="l">Starting XI set</div></div>
      ${data.formation ? `<div class="fpl-stat"><div class="v">${esc(data.formation)}</div><div class="l">Formation</div></div>` : ""}
    </div>
    <div class="fpl-captaincy-line">
      ${captain ? `<span>🅒 Captain: <b>${esc(captain.name)}</b></span>` : ""}
      ${vice ? `<span>🅥 Vice-Captain: <b>${esc(vice.name)}</b></span>` : ""}
    </div>
    <div class="pitch">
      ${pitchRow("GKP")}
      ${pitchRow("DEF")}
      ${pitchRow("MID")}
      ${pitchRow("FWD")}
      <div class="bench-strip">${bench.map(playerCard).join("")}</div>
    </div>
    ${analysisSectionHtml(data, starters, bench)}`;
}

export function openFplPlayer(p) {
  document.getElementById("fplPlayerModalTitle").textContent = `${p.name} (${p.position})`;
  const badge = p.isCaptain ? "Captain" : p.isVice ? "Vice-captain" : null;
  const opponentText = p.opponent ? `${p.isHome ? "vs" : "@"} ${p.opponent} (${p.isHome ? "Home" : "Away"})` : "No fixture this gameweek";
  document.getElementById("fplPlayerModalBody").innerHTML = `
    <div class="scout-meta">
      <p><b>${esc(p.teamName)}</b> — £${(p.priceTenths / 10).toFixed(1)}m ${badge ? `· <b>${badge}</b>` : ""}</p>
      <p>This gameweek: <b>${esc(opponentText)}</b></p>
      <p>Projected xPts (next horizon): <b>${p.xPts}</b>${p.actualPoints != null ? ` · Actual points: <b>${p.actualPoints}</b>` : ""}</p>
      <p>${esc(p.justification)}</p>
    </div>`;
  openModal("fplPlayerModal");
}
