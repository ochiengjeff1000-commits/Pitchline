import { state } from "./state.js";
import { api, demoFallback } from "./api.js";
import { esc, pickLabel, confidenceTier } from "./utils.js";
import { DEMO_JACKPOTS } from "./demoData.js";

function jackpotResultBadge(j) {
  if (j.status !== "SETTLED" || j.correctCount == null) return "";
  const cls = j.correctCount === j.totalGames ? "good" : j.correctCount >= j.totalGames * 0.7 ? "mid" : "bad";
  return `<span class="jp-history-score ${cls}">${j.correctCount}/${j.totalGames}</span>`;
}

function jackpotCard(j) {
  return `
    <div class="jackpot-card" data-open-jackpot="${j.id}">
      <div class="platform">${esc(j.platformLabel || j.platform)} · ${esc(tierTypeLabel(j.type, j.platform))}</div>
      <h3>${esc(j.label)}</h3>
      <div class="meta">${j.totalGames} games · ${j.status === "OPEN" ? "Open for predictions" : j.status === "SETTLED" ? "Settled" : j.status} ${jackpotResultBadge(j)}</div>
    </div>`;
}

/* ============ TASK 2 — Tier structuring & settlement accordion ============ */

/**
 * Groups the flat jackpot list into platform -> type "tiers", e.g.
 * SportPesa { MEGA: [...], MIDWEEK: [...] }, Mozzart { GRAND: [...],
 * DAILY: [...] }, etc. — so multi-tier bookmaker jackpots are always
 * shown under clean per-tier headings rather than one undifferentiated
 * list. Preserves platform/type order of first appearance.
 */
function groupByPlatformAndType(list) {
  const platforms = new Map();
  for (const j of list) {
    if (!platforms.has(j.platform)) platforms.set(j.platform, { label: j.platformLabel || j.platform, types: new Map() });
    const p = platforms.get(j.platform);
    if (!p.types.has(j.type)) p.types.set(j.type, []);
    p.types.get(j.type).push(j);
  }
  return platforms;
}

function tierTypeLabel(type, platform) {
  if (platform === "MOZZART" && type === "GRAND") return "Super Grand Jackpot"; // Mozzart's actual product name for this tier
  const labels = {
    MEGA: "Mega Jackpot", MIDWEEK: "Midweek Jackpot", GRAND: "Grand Jackpot",
    DAILY: "Daily Jackpot", WEEKLY: "Weekly Jackpot", SABABISHA: "Sababisha Jackpot",
  };
  return labels[type] || type;
}

function activeTiersSection(platforms) {
  const blocks = [];
  for (const [platformKey, platform] of platforms) {
    const typeBlocks = [];
    for (const [type, jackpots] of platform.types) {
      const active = jackpots.filter((j) => j.status !== "SETTLED");
      if (active.length === 0) continue;
      typeBlocks.push(`
        <div class="jp-tier-group">
          <h4 class="jp-tier-heading">${esc(tierTypeLabel(type, platformKey))}</h4>
          <div class="jp-tier-cards">${active.map(jackpotCard).join("")}</div>
        </div>`);
    }
    if (typeBlocks.length === 0) continue;
    blocks.push(`
      <div class="jp-platform-group">
        <h3 class="jp-platform-heading">${esc(platform.label)}</h3>
        ${typeBlocks.join("")}
      </div>`);
  }
  return blocks.join("") || `<div class="empty-state">No active jackpots ingested yet.</div>`;
}

/** Finished/completed jackpots (status === "SETTLED") — collapsed by
 * default so they don't clutter the active feed; each row expands
 * in-place into the full per-leg settlement breakdown on click. */
function completedAccordionSection(list) {
  const completed = list
    .filter((j) => j.status === "SETTLED")
    .sort((a, b) => new Date(b.settledAt || 0) - new Date(a.settledAt || 0));
  if (completed.length === 0) return "";

  const rows = completed.map((j) => `
    <div class="jp-accordion-item" data-jackpot-id="${j.id}">
      <div class="jp-accordion-header" data-toggle-jackpot-accordion="${j.id}">
        <div class="jp-accordion-title">
          <span class="platform">${esc(j.platformLabel || j.platform)} · ${esc(tierTypeLabel(j.type, j.platform))}</span>
          <span class="label">${esc(j.label)}</span>
        </div>
        ${jackpotResultBadge(j)}
        <svg class="chevron" viewBox="0 0 20 20" fill="none"><path d="M5 7l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="jp-accordion-body" id="jp-accordion-body-${j.id}"></div>
    </div>`).join("");

  return `
    <div class="jp-completed-accordion">
      <h3 class="jp-platform-heading">Past / Completed Jackpots</h3>
      ${rows}
    </div>`;
}

function kickoffLine(kickoff) {
  if (!kickoff) return "";
  const d = new Date(kickoff);
  const dateStr = d.toLocaleDateString([], { day: "2-digit", month: "short" });
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `<span class="selection-kickoff mono">${dateStr}, ${timeStr}</span>`;
}

function legSettlementRow(sel) {
  const p = sel.prediction;
  const hasResult = sel.homeScore != null && sel.awayScore != null;
  const actualScoreStr = hasResult ? `${sel.homeScore} - ${sel.awayScore}` : "—";

  let resultBadge = "";
  if (p && p.isCorrect != null) {
    resultBadge = p.isCorrect
      ? `<span class="settle-badge won">WON</span>`
      : `<span class="settle-badge lost">LOST</span>`;
  } else {
    resultBadge = `<span class="settle-badge pending">PENDING</span>`;
  }

  return `
    <div class="settle-row">
      <span class="selection-pos mono">${sel.position}</span>
      <div class="settle-teams">
        <div class="teams">${esc(sel.homeTeam)} vs ${esc(sel.awayTeam)}</div>
        <div class="settle-line">
          ${kickoffLine(sel.kickoff)}
          <span class="picked">Picked: <b>${p ? pickLabel(p.predictedOutcome) : "—"}</b></span>
          <span class="actual">Final: <b>${actualScoreStr}</b></span>
        </div>
      </div>
      ${resultBadge}
    </div>`;
}

async function loadCompletedBreakdown(jackpotId) {
  const body = document.getElementById(`jp-accordion-body-${jackpotId}`);
  if (!body) return;
  if (body.dataset.loaded === "true") return; // already fetched, just toggling visibility

  body.innerHTML = `<div class="empty-state">Loading breakdown…</div>`;
  const data = await api(`/api/jackpots/${jackpotId}`);
  if (!data) {
    body.innerHTML = `<div class="empty-state">Couldn't load this jackpot's breakdown.</div>`;
    return;
  }

  const rows = data.selections.map(legSettlementRow).join("");
  const summary = data.correctCount != null
    ? `<div class="settle-summary">${data.correctCount} / ${data.selections.length} Correct Picks</div>`
    : "";

  body.innerHTML = `${summary}${rows}`;
  body.dataset.loaded = "true";
}

export function toggleCompletedAccordion(jackpotId) {
  const item = document.querySelector(`.jp-accordion-item[data-jackpot-id="${jackpotId}"]`);
  if (!item) return;
  const wasOpen = item.classList.contains("open");
  item.classList.toggle("open", !wasOpen);
  if (!wasOpen) loadCompletedBreakdown(jackpotId);
}

export async function loadJackpots() {
  const list = await api("/api/jackpots") ?? demoFallback(DEMO_JACKPOTS) ?? [];
  const el = document.getElementById("jackpotList");
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state">No active jackpots ingested yet.</div>`;
    return;
  }
  const platforms = groupByPlatformAndType(list);
  el.innerHTML = activeTiersSection(platforms) + completedAccordionSection(list);
}

/* ============ Jackpot detail modal (unchanged — open pool, unlock, slips) ============ */

function selectionRow(sel) {
  if (sel.locked) {
    return `
      <div class="selection-row">
        <span class="selection-pos mono">${sel.position}</span>
        <div class="selection-teams selection-locked-content">
          <div>${esc(sel.homeTeam)} vs ${esc(sel.awayTeam)}</div>
          ${kickoffLine(sel.kickoff)}
        </div>
        <span class="lock-icon">🔒</span>
      </div>`;
  }
  const p = sel.prediction;
  const conf = p ? confidenceTier(p.confidence) : null;
  return `
    <div class="selection-row">
      <span class="selection-pos mono">${sel.position}</span>
      <div class="selection-teams">
        <div>${esc(sel.homeTeam)} vs ${esc(sel.awayTeam)}${p ? `<span class="pick-chip" style="margin-left:8px;">${pickLabel(p.predictedOutcome)}</span><span class="conf-badge ${conf.cls}" style="margin-left:6px;">${conf.label}</span>` : ""}</div>
        ${kickoffLine(sel.kickoff)}
      </div>
    </div>`;
}

function slipCard(label, slip) {
  return `
    <div class="slip-card">
      <h4>${esc(label)}</h4>
      ${slip.selections.map((s) => `<div class="sel"><span>#${s.position}</span><b>${esc(s.pick)}</b></div>`).join("")}
    </div>`;
}

function previousJackpotsSection(data) {
  const history = data.previousResults || [];
  if (history.length === 0) return "";
  const rows = history.map((h) => {
    const when = h.settledAt ? new Date(h.settledAt).toLocaleDateString([], { month: "short", day: "numeric" }) : new Date(h.createdAt).toLocaleDateString([], { month: "short", day: "numeric" });
    let scoreEl;
    if (h.status !== "SETTLED" || h.correctCount == null) {
      scoreEl = `<span class="jp-history-score pending">Pending</span>`;
    } else {
      const cls = h.correctCount === h.totalGames ? "good" : h.correctCount >= h.totalGames * 0.7 ? "mid" : "bad";
      scoreEl = `<span class="jp-history-score ${cls}">${h.correctCount}/${h.totalGames}</span>`;
    }
    return `<div class="jp-history-row"><div><div class="lbl">${esc(h.label)}</div><div class="when">${when}</div></div>${scoreEl}</div>`;
  }).join("");
  return `<div class="jp-history"><h4>Last ${history.length} ${esc(data.platformLabel || data.platform)} ${esc(data.type)} jackpot${history.length > 1 ? "s" : ""} — confirm previous results</h4>${rows}</div>`;
}

export async function openJackpot(id) {
  state.currentJackpotId = id;
  const qs = state.phoneNumber ? `?phone=${encodeURIComponent(state.phoneNumber)}` : "";
  const data = await api(`/api/jackpots/${id}${qs}`);
  const modal = document.getElementById("jackpotModal");
  const body = document.getElementById("jackpotModalBody");
  document.getElementById("jackpotModalTitle").textContent = data?.label || "Jackpot";

  if (!data) {
    body.innerHTML = `<div class="empty-state">Couldn't load this jackpot. Is the API running?</div>`;
    modal.classList.add("open");
    return;
  }

  let html = data.selections.map(selectionRow).join("");
  if (!data.unlocked) {
    html += `
      <div class="unlock-banner">
        <p>Unlock ${data.selections.length - state.FREE_TEASER_COUNT} more games + 3 strategy slips for <span class="price">KES ${data.unlockPriceKes}</span></p>
        <button class="btn-primary" id="openUnlockFromJackpot">Unlock now</button>
      </div>`;
  } else if (data.slips) {
    html += `
      <div class="slips-grid">
        ${slipCard(data.slips.slipA.label, data.slips.slipA)}
        ${slipCard(data.slips.slipB.label, data.slips.slipB)}
        ${slipCard(data.slips.slipC.label, data.slips.slipC)}
      </div>`;
  }
  html += previousJackpotsSection(data);
  body.innerHTML = html;
  modal.classList.add("open");

  const unlockBtn = document.getElementById("openUnlockFromJackpot");
  if (unlockBtn) unlockBtn.addEventListener("click", () => {
    document.getElementById("jackpotModal").classList.remove("open");
    document.getElementById("unlockPrice").textContent = "KES " + data.unlockPriceKes;
    document.getElementById("unlockModal").classList.add("open");
  });
}

export async function submitUnlock() {
  const input = document.getElementById("phoneInput");
  const status = document.getElementById("unlockStatus");
  const phone = input.value.trim();
  if (!/^254\d{9}$/.test(phone)) {
    status.textContent = "Enter a valid number in 2547XXXXXXXX format.";
    status.className = "status-line error";
    return;
  }
  state.phoneNumber = phone;
  localStorage.setItem("pl_phone", phone);
  status.textContent = "Sending payment prompt…";
  status.className = "status-line";

  const res = await api(`/api/jackpots/${state.currentJackpotId}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  });

  if (!res) {
    status.textContent = "Couldn't reach the payment API. Try again shortly.";
    status.className = "status-line error";
    return;
  }
  status.textContent = "Prompt sent — approve it on your phone. Checking for confirmation…";
  status.className = "status-line success";
  pollUnlock();
}

async function pollUnlock() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const data = await api(`/api/jackpots/${state.currentJackpotId}?phone=${encodeURIComponent(state.phoneNumber)}`);
    if (data?.unlocked) {
      document.getElementById("unlockStatus").textContent = "Unlocked! Reopening jackpot…";
      setTimeout(() => {
        document.getElementById("unlockModal").classList.remove("open");
        openJackpot(state.currentJackpotId);
      }, 800);
      return;
    }
  }
  document.getElementById("unlockStatus").textContent = "Still waiting on confirmation — you can close this and reopen the jackpot once you've approved the prompt.";
}
