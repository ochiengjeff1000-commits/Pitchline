import { state } from "./state.js";
import { api, demoFallback } from "./api.js";
import { esc, isFixtureLive, pickLabel, tierIcon, formatLiveClock } from "./utils.js";
import { SPORT_LABELS } from "./constants.js";
import { DEMO_LEAGUES, DEMO_STATS, DEMO_SPORTS } from "./demoData.js";
import { favoriteStarHtml, renderMyGames } from "./favorites.js";

export { isFixtureLive };

/* ============ LIVE TICKER ============ */
export function renderTicker(leagues) {
  const tierRank = { TIER_1: 1, TIER_2: 2, TIER_3: 3, TIER_4: 4 };

  const sortedLeagues = [...leagues].sort((a, b) => (tierRank[a.tier] || 99) - (tierRank[b.tier] || 99));

  const liveItems = sortedLeagues.flatMap((league) =>
    (league.fixtures || [])
      .filter(isFixtureLive)
      .map((f) => {
        const isHt = f.status === "HT" || f.status === "HALFTIME";
        const timeDisplay = isHt ? "HT" : formatLiveClock(f);
        return `
          <span class="ticker-item" data-open-match="${f.id}">
            <span class="dot"></span>
            <span class="ticker-league">${esc(league.name)}:</span>
            <span class="ticker-time${isHt ? " ht" : ""}">${timeDisplay}</span>
            <span class="teams">${esc(f.homeTeam.name)} vs ${esc(f.awayTeam.name)}</span>
            <span class="score">${f.homeScore ?? 0}-${f.awayScore ?? 0}</span>
          </span>`;
      })
  );

  const el = document.getElementById("ticker");
  if (liveItems.length === 0) {
    el.innerHTML = `<span class="ticker-empty">No live matches right now — check back at kickoff</span>`;
    return;
  }
  const track = liveItems.join("") + liveItems.join("");
  el.innerHTML = `<div class="ticker-track">${track}</div>`;
}

/* ============ LIVESCORE FIXTURE ROW ============ */
export function fixtureRow(f, filterMode) {
  const kickoff = new Date(f.kickoff);
  const time = kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const pred = f.prediction;

  let chip = "";
  if (pred && filterMode !== "fixtures" && filterMode !== "live") {
    if (filterMode === "btts") {
      chip = `<span class="pick-chip">${pred.predictedBtts ? "GG" : "NG"}</span>`;
    } else {
      chip = `<span class="pick-chip">${pickLabel(pred.predictedOutcome)}<span class="pick-conf">${Math.round((pred.confidence || 0) * 100)}%</span></span>`;
    }
  }

  const dateStr = kickoff.toLocaleDateString([], { day: "2-digit", month: "short" });
  const dateLine = `<span class="fx-date">${dateStr}</span>`;

  let statusBadge = "";
  if (f.status === "HT" || f.status === "HALFTIME") {
    statusBadge = `<span class="fx-minute-badge ht"><span class="dot"></span>HT</span>${dateLine}`;
  } else if (isFixtureLive(f)) {
    const minStr = formatLiveClock(f);
    statusBadge = `<span class="fx-minute-badge live"><span class="dot"></span>${minStr}</span>${dateLine}`;
  } else if (f.status === "FT" || f.status === "FINISHED") {
    statusBadge = `<span class="fx-minute-badge ft">FT</span>${dateLine}`;
  } else {
    statusBadge = `<span class="fx-minute-badge scheduled">${time}</span>${dateLine}`;
  }

  const homeLogo = f.homeTeam.logoUrl ? `<img src="${esc(f.homeTeam.logoUrl)}" alt="" class="team-logo" onerror="this.style.display='none'">` : "";
  const awayLogo = f.awayTeam.logoUrl ? `<img src="${esc(f.awayTeam.logoUrl)}" alt="" class="team-logo" onerror="this.style.display='none'">` : "";

  const homeScoreVal = (f.homeScore != null) ? f.homeScore : "-";
  const awayScoreVal = (f.awayScore != null) ? f.awayScore : "-";

  // TASK 1 — Strict tab separation: Scores & Fixtures shows ONLY standard
  // match metadata (logos/names, live/FT status, scoreline, kickoff time,
  // info link). Prediction chips are already gated to filterMode !==
  // "fixtures"/"live" above (Predictions tab only) — jackpot bookmaker
  // badges (e.g. "🏆 Mozzart Bet") never belong here at all, so they're
  // removed entirely rather than gated; that association is now surfaced
  // only inside the dedicated Jackpots tab, where each jackpot's own game
  // list already shows the fixtures it covers.

  return `
    <div class="fixture-row" data-open-match="${f.id}">
      <div class="fx-status-col">${statusBadge}</div>
      <div class="fx-teams">
        <div class="t-line">
          <span class="t-name">${homeLogo}${esc(f.homeTeam.name)}${favoriteStarHtml(f.homeTeam.id, f.homeTeam.name)}</span>
          <span class="t-score">${homeScoreVal}</span>
        </div>
        <div class="t-line">
          <span class="t-name">${awayLogo}${esc(f.awayTeam.name)}${favoriteStarHtml(f.awayTeam.id, f.awayTeam.name)}</span>
          <span class="t-score">${awayScoreVal}</span>
        </div>
      </div>
      ${chip}
      <button class="btn-ghost insights-btn" data-open-match="${f.id}" aria-label="Match details">ⓘ</button>
    </div>`;
}

function leagueCard(league, filterMode) {
  let fixtures = league.fixtures || [];
  if (filterMode === "live") fixtures = fixtures.filter(isFixtureLive);
  if (filterMode === "1x2") fixtures = fixtures.filter((f) => f.prediction);
  if (filterMode === "btts") fixtures = fixtures.filter((f) => f.prediction && f.prediction.predictedBtts != null);
  if (fixtures.length === 0) return "";

  const tierClass = league.tier === "TIER_1" ? "tier-1" : league.tier === "TIER_2" ? "tier-2" : "";
  const open = league.tier === "TIER_1" || league.tier === "TIER_2" || filterMode === "live";
  return `
    <div class="league-card ${tierClass} ${open ? "open" : ""}">
      <div class="league-head" data-toggle-league>
        <div class="league-badge">${tierIcon(league.tier)}</div>
        <div class="league-title">
          <div class="name">${esc(league.name)}</div>
          <div class="country">${esc(league.country || "")}</div>
        </div>
        <span class="league-count mono">${fixtures.length}</span>
        <svg class="chevron" viewBox="0 0 20 20" fill="none"><path d="M5 7l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="league-body">
        ${fixtures.map((f) => fixtureRow(f, filterMode)).join("")}
      </div>
    </div>`;
}

function renderFixtureView(containerId, leagues, filterMode) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const html = leagues.map((l) => leagueCard(l, filterMode)).join("");
  const emptyMsg = filterMode === "live"
    ? `No live games currently in progress for ${SPORT_LABELS[state.currentSport] || state.currentSport}.`
    : "No fixtures to show for this filter yet.";
  el.innerHTML = html || `<div class="empty-state">${emptyMsg}</div>`;
}

/** Re-renders every fixture-driven view from state.allLoadedLeagues. */
export function renderAll() {
  const leagues = state.allLoadedLeagues;

  const liveCount = leagues.flatMap((l) => (l.fixtures || []).filter(isFixtureLive)).length;
  const liveBadge = document.getElementById("liveTabCount");
  if (liveBadge) liveBadge.textContent = liveCount > 0 ? `(${liveCount})` : "(0)";

  renderTicker(leagues);
  renderFixtureView("leagueList-fixtures", leagues, "fixtures");
  renderFixtureView("leagueList-live", leagues, "live");
  renderFixtureView("leagueList-all", leagues, "all");
  renderFixtureView("leagueList-1x2", leagues, "1x2");
  renderFixtureView("leagueList-btts", leagues, "btts");

  const dateStr = new Date(state.currentDate + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const todayDate = document.getElementById("todayDate");
  if (todayDate) todayDate.textContent = dateStr;
  const dateStr0 = document.getElementById("todayDate0");
  if (dateStr0) dateStr0.textContent = dateStr;
}

export async function loadFixtures() {
  const data = await api(`/api/fixtures?sport=${state.currentSport}&date=${state.currentDate}`);
  const leagues = data?.leagues
    ?? demoFallback(DEMO_LEAGUES.filter((l) => l.sport === state.currentSport))
    ?? [];
  state.allLoadedLeagues = leagues;
  renderAll();
  renderMyGames();
}

/**
 * Merges a real-time SSE payload (id/status/score/clock only) into the
 * already-loaded leagues in place, then re-renders — this is what makes
 * the dashboard update itself the way LiveScore's does, without a full
 * fixtures re-fetch every few seconds.
 */
export function applyLiveDelta(liveFixtures) {
  if (!Array.isArray(liveFixtures) || liveFixtures.length === 0) return;
  const byId = new Map(liveFixtures.map((f) => [String(f.id), f]));
  let changed = false;

  for (const league of state.allLoadedLeagues) {
    for (const f of league.fixtures || []) {
      const update = byId.get(String(f.id));
      if (!update) continue;
      f.status = update.status;
      f.homeScore = update.homeScore;
      f.awayScore = update.awayScore;
      f.clockMinute = update.clockMinute;
      f.periodLabel = update.periodLabel;
      f.isLive = true;
      changed = true;
    }
  }

  if (changed) renderAll();
}

export function renderSportSelector(sports) {
  const el = document.getElementById("sportSelector");
  el.innerHTML = sports.map((s) => `<button class="sport-btn${s === state.currentSport ? " active" : ""}" data-select-sport="${s}">${SPORT_LABELS[s] || s}</button>`).join("");
}

export async function loadSports() {
  const sports = await api("/api/sports") ?? demoFallback(DEMO_SPORTS) ?? [];
  renderSportSelector(sports);
}

export async function loadStats() {
  const stats = await api("/api/stats/site") ?? demoFallback(DEMO_STATS);
  const badge = document.getElementById("winrateBadge");
  badge.querySelector(".figure").textContent = (stats?.winRate1x2 ?? "—") + "%";
}
