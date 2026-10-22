const API_BASE = "";
let adminKey = sessionStorage.getItem("pitchline_admin_key") || "";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function adminFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    showLogin("Invalid or expired admin key.");
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function showLogin(errorMsg) {
  sessionStorage.removeItem("pitchline_admin_key");
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("adminApp").style.display = "none";
  document.getElementById("loginError").textContent = errorMsg || "";
}

function showApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("adminApp").style.display = "block";
  loadDashboard();
}

/* ============ DASHBOARD ============ */
async function loadDashboard() {
  const el = document.getElementById("admin-tab-dashboard");
  el.innerHTML = `<div class="admin-loading">Loading dashboard…</div>`;
  try {
    const d = await adminFetch("/admin/dashboard");

    const statCard = (label, value) => `<div class="admin-stat"><div class="v">${value}</div><div class="l">${label}</div></div>`;

    const failuresHtml = d.recentFailures.length
      ? d.recentFailures.map((f) => `<div class="admin-log-row failed"><b>${esc(f.jobName)}</b><span>${esc(f.errorMessage || "")}</span><span class="admin-log-time">${new Date(f.createdAt).toLocaleString()}</span></div>`).join("")
      : `<div class="admin-empty">No job failures in the last 24 hours.</div>`;

    const logsHtml = d.recentLogs.map((l) => `
      <div class="admin-log-row ${l.status}">
        <b>${esc(l.jobName)}</b>
        <span>${l.fixturesIn} in · ${l.predictionsOut} out · ${l.apiCallsUsed} API calls</span>
        <span class="admin-log-time">${new Date(l.createdAt).toLocaleString()}</span>
      </div>`).join("");

    el.innerHTML = `
      <div class="admin-stats-row">
        ${statCard("Total Fixtures", d.totalFixtures)}
        ${statCard("Total Predictions", d.totalPredictions)}
        ${statCard("Prediction Accuracy", d.predictionAccuracy != null ? d.predictionAccuracy + "%" : "—")}
        ${statCard("Settled Predictions", d.settledPredictions)}
        ${statCard("Pending Jackpots", d.pendingJackpotCount)}
        ${statCard("Payments (24h)", d.paymentsLast24h)}
        ${statCard("Active Unlocks", d.totalActiveUnlocks)}
        ${statCard("Unlock Price", d.settings.isFree ? "FREE" : "KES " + d.settings.unlockAmountKes)}
      </div>
      <h3>Failures (last 24h)</h3>
      <div class="admin-log-list">${failuresHtml}</div>
      <h3>Recent Job Runs</h3>
      <div class="admin-log-list">${logsHtml}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="admin-error">Failed to load dashboard: ${esc(err.message)}</div>`;
  }
}

/* ============ SETTINGS ============ */
async function loadSettings() {
  const el = document.getElementById("admin-tab-settings");
  el.innerHTML = `<div class="admin-loading">Loading settings…</div>`;
  try {
    const s = await adminFetch("/admin/settings");
    el.innerHTML = `
      <div class="admin-card">
        <h3>Jackpot Unlock Price</h3>
        <p class="admin-hint">Set to 0 to make every jackpot free for everyone — this bypasses M-Pesa entirely, no IntaSend charge happens. Set to any positive number to charge that amount in KES via M-Pesa STK push.</p>
        <div class="admin-form-row">
          <label><input type="radio" name="pricingMode" id="modeFree" ${s.isFree ? "checked" : ""}> Free for everyone</label>
          <label><input type="radio" name="pricingMode" id="modePaid" ${!s.isFree ? "checked" : ""}> Charge a fee</label>
        </div>
        <div class="admin-form-row">
          <label for="unlockAmountInput">Amount (KES)</label>
          <input type="number" id="unlockAmountInput" min="0" value="${s.unlockAmountKes}" ${s.isFree ? "disabled" : ""}>
        </div>
        <button id="saveSettingsBtn" class="admin-btn admin-btn-primary">Save</button>
        <div id="settingsSaveMsg" class="admin-save-msg"></div>
      </div>`;

    const freeRadio = document.getElementById("modeFree");
    const paidRadio = document.getElementById("modePaid");
    const amountInput = document.getElementById("unlockAmountInput");
    freeRadio.onchange = () => { amountInput.disabled = true; };
    paidRadio.onchange = () => { amountInput.disabled = false; if (Number(amountInput.value) === 0) amountInput.value = 49; };

    document.getElementById("saveSettingsBtn").onclick = async () => {
      const msg = document.getElementById("settingsSaveMsg");
      const amount = freeRadio.checked ? 0 : Number(amountInput.value);
      try {
        await adminFetch("/admin/settings", { method: "POST", body: JSON.stringify({ unlockAmountKes: amount }) });
        msg.textContent = "Saved.";
        msg.className = "admin-save-msg success";
      } catch (err) {
        msg.textContent = "Failed: " + err.message;
        msg.className = "admin-save-msg error";
      }
    };
  } catch (err) {
    el.innerHTML = `<div class="admin-error">Failed to load settings: ${esc(err.message)}</div>`;
  }
}

/* ============ JACKPOTS ============ */
async function loadJackpots() {
  const el = document.getElementById("admin-tab-jackpots");
  el.innerHTML = `
    <div class="admin-card">
      <h3>Type In Games For A New Jackpot</h3>
      <p class="admin-hint">Paste the game list as plain text — one game per line, e.g. "1. Manchester United vs Chelsea". Numbering and separators (vs / v / -) are flexible. Lands in the pending list below for review before it goes live.</p>
      <div class="admin-form-row">
        <label for="qpPlatform">Platform</label>
        <select id="qpPlatform">
          <option value="SPORTPESA">SportPesa</option>
          <option value="BETIKA">Betika</option>
          <option value="MOZZART">Mozzart</option>
          <option value="SHABIKI">Shabiki</option>
        </select>
      </div>
      <div class="admin-form-row">
        <label for="qpType">Type</label>
        <select id="qpType">
          <option value="MEGA">Mega</option>
          <option value="MIDWEEK">Midweek</option>
          <option value="GRAND">Grand</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
        </select>
      </div>
      <div class="admin-form-row">
        <label for="qpLabel">Label</label>
        <input type="text" id="qpLabel" placeholder="e.g. SportPesa Mega Jackpot - Week 30">
      </div>
      <div class="admin-form-row">
        <label for="qpText">Games</label>
        <textarea id="qpText" rows="8" placeholder="1. Manchester United vs Chelsea&#10;2. Arsenal - Liverpool&#10;..."></textarea>
      </div>
      <button id="qpSubmitBtn" class="admin-btn admin-btn-primary">Parse &amp; Submit for Review</button>
      <div id="qpMsg" class="admin-save-msg"></div>
    </div>
    <h3>Pending Review</h3>
    <div id="pendingList" class="admin-loading">Loading…</div>`;

  document.getElementById("qpSubmitBtn").onclick = async () => {
    const msg = document.getElementById("qpMsg");
    const platform = document.getElementById("qpPlatform").value;
    const type = document.getElementById("qpType").value;
    const label = document.getElementById("qpLabel").value.trim();
    const text = document.getElementById("qpText").value;

    if (!label || !text.trim()) {
      msg.textContent = "Label and games are both required.";
      msg.className = "admin-save-msg error";
      return;
    }

    try {
      const result = await adminFetch("/admin/jackpots/quick-ingest", {
        method: "POST",
        body: JSON.stringify({ platform, type, label, text }),
      });
      msg.textContent = `Parsed ${result.parsedCount} game(s), matched ${result.matchedCount}. ${result.skipped.length ? `${result.skipped.length} line(s) couldn't be parsed.` : ""} Awaiting review below.`;
      msg.className = "admin-save-msg success";
      document.getElementById("qpText").value = "";
      loadPendingJackpots();
    } catch (err) {
      msg.textContent = "Failed: " + err.message;
      msg.className = "admin-save-msg error";
    }
  };

  loadPendingJackpots();
}

async function loadPendingJackpots() {
  const el = document.getElementById("pendingList");
  try {
    const pending = await adminFetch("/admin/jackpots/pending");
    if (pending.length === 0) {
      el.innerHTML = `<div class="admin-empty">Nothing waiting for review.</div>`;
      return;
    }
    el.innerHTML = pending.map((j) => `
      <div class="admin-card">
        <div class="admin-jackpot-head">
          <b>${esc(j.label)}</b>
          <span>${esc(j.platform)} · ${esc(j.type)} · matched ${j.matchedCount}/${j.totalGames}${j.autoCreatedCount ? ` (${j.autoCreatedCount} auto-created — no existing fixture, verify team names before approving)` : ""}</span>
        </div>
        <div class="admin-jackpot-games">
          ${j.selections.map((s) => `<div class="admin-jackpot-game">${s.position}. ${esc(s.homeTeam)} vs ${esc(s.awayTeam)}${s.autoCreated ? ` <span class="admin-tag-auto">auto</span>` : ""}</div>`).join("")}
        </div>
        <div class="admin-jackpot-actions">
          <button class="admin-btn admin-btn-primary" data-approve="${j.id}">Approve &amp; Publish</button>
          <button class="admin-btn admin-btn-danger" data-reject="${j.id}">Reject</button>
        </div>
      </div>`).join("");

    el.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await adminFetch(`/admin/jackpots/${btn.dataset.approve}/approve`, { method: "POST" });
          loadPendingJackpots();
        } catch (err) { alert("Failed to approve: " + err.message); }
      };
    });
    el.querySelectorAll("[data-reject]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Reject and delete this jackpot draft? This can't be undone.")) return;
        try {
          await adminFetch(`/admin/jackpots/${btn.dataset.reject}`, { method: "DELETE" });
          loadPendingJackpots();
        } catch (err) { alert("Failed to reject: " + err.message); }
      };
    });
  } catch (err) {
    el.innerHTML = `<div class="admin-error">Failed to load pending jackpots: ${esc(err.message)}</div>`;
  }
}

/* ============ MANUAL SYNC ============ */
const SYNC_JOB_LABELS = {
  dailyFixtures: "Daily Fixture Sync (API-Sports)",
  footballData: "Football-Data.org Sync",
  standings: "Standings Sync",
  postponement: "Postponement Check",
  settlement: "Settlement Job",
  espnLive: "ESPN Live Tick",
  nonFootballLive: "Non-Football Live Tick",
  stuckMatchGuard: "Stuck Match Guard",
  news: "News Sync",
  fpl: "FPL Sync",
  fplSquad: "FPL Squad Generation",
  jackpotAutoSync: "Jackpot Auto-Sync (all platforms)",
};

function loadSyncPanel() {
  const el = document.getElementById("admin-tab-sync");
  el.innerHTML = `
    <p class="admin-hint">Trigger any scheduled job right now instead of waiting for its cron cadence. Useful right after deploying, or to verify a job works.</p>
    <div class="admin-sync-grid">
      ${Object.entries(SYNC_JOB_LABELS).map(([key, label]) => `
        <div class="admin-sync-item">
          <span>${esc(label)}</span>
          <button class="admin-btn admin-btn-ghost" data-sync="${key}">Run now</button>
          <span class="admin-sync-status" id="sync-status-${key}"></span>
        </div>`).join("")}
    </div>`;

  el.querySelectorAll("[data-sync]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.sync;
      const statusEl = document.getElementById(`sync-status-${key}`);
      btn.disabled = true;
      statusEl.textContent = "Running…";
      statusEl.className = "admin-sync-status running";
      try {
        await adminFetch(`/admin/sync/${key}`, { method: "POST" });
        statusEl.textContent = "Done";
        statusEl.className = "admin-sync-status success";
      } catch (err) {
        statusEl.textContent = "Failed: " + err.message;
        statusEl.className = "admin-sync-status error";
      } finally {
        btn.disabled = false;
      }
    };
  });
}

/* ============ NAV / LOGIN ============ */
const TAB_LOADERS = { dashboard: loadDashboard, settings: loadSettings, jackpots: loadJackpots, sync: loadSyncPanel };

document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.adminTab;
    document.getElementById(`admin-tab-${tab}`).classList.add("active");
    TAB_LOADERS[tab]();
  });
});

document.getElementById("adminLoginBtn").addEventListener("click", async () => {
  const key = document.getElementById("adminKeyInput").value.trim();
  if (!key) return;
  adminKey = key;
  try {
    await adminFetch("/admin/dashboard"); // validates the key
    sessionStorage.setItem("pitchline_admin_key", key);
    showApp();
  } catch (err) {
    if (err.message !== "unauthorized") {
      document.getElementById("loginError").textContent = "Sign-in failed: " + err.message;
    }
  }
});

document.getElementById("adminKeyInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("adminLoginBtn").click();
});

document.getElementById("logoutBtn").addEventListener("click", () => showLogin());

if (adminKey) {
  adminFetch("/admin/dashboard").then(() => showApp()).catch(() => showLogin());
} else {
  showLogin();
}