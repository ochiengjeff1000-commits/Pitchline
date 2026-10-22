import { state } from "./state.js";
import { closeModal } from "./utils.js";
import { loadFixtures, loadSports, loadStats } from "./fixtures.js";
import { connectLiveStream } from "./live.js";
import { openMatchCenter, stopMatchCenterPolling } from "./matchCenter.js";
import { openTeamProfile } from "./teamProfile.js";
import { loadFplSquad, openFplPlayer } from "./fpl.js";
import { loadJackpots, openJackpot, submitUnlock, toggleCompletedAccordion } from "./jackpots.js";
import { loadNews } from "./news.js";
import { runSearch } from "./search.js";
import { loadBestBet, loadAccuracy } from "./trackRecord.js";
import { toggleFavoriteTeam } from "./favorites.js";

function closeAnyModal(id) {
  closeModal(id, id === "matchCenterModal" ? stopMatchCenterPolling : undefined);
}

/* ============ GLOBAL DELEGATED CLICK HANDLING ============ */
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) {
    document.getElementById("searchDropdown").classList.remove("open");
  }

  /* Top-level tab switches */
  const tab = e.target.closest(".tab-btn");
  if (tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.target;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById("view-" + target).classList.add("active");
    return;
  }

  /* Predictions sub-tabs */
  const subTab = e.target.closest("[data-sub]");
  if (subTab) {
    document.querySelectorAll(".sub-tab-btn").forEach((b) => b.classList.remove("active"));
    subTab.classList.add("active");
    const sub = subTab.dataset.sub;
    document.querySelectorAll("#view-predictions .sub-view").forEach((v) => v.style.display = "none");
    document.getElementById("subview-" + sub).style.display = "";
    const titles = { all: "All predictions", "1x2": "1X2 picks", btts: "Both Teams to Score", jackpots: "Active jackpots" };
    document.getElementById("predictionsTitle").textContent = titles[sub] || "Predictions";
    if (sub === "jackpots") loadJackpots();
    return;
  }

  /* Track record window picker (7d/30d/90d) */
  const winBtn = e.target.closest("#accuracyWindowPicker .win-btn");
  if (winBtn) {
    document.querySelectorAll("#accuracyWindowPicker .win-btn").forEach((b) => b.classList.remove("active"));
    winBtn.classList.add("active");
    loadAccuracy(winBtn.dataset.days);
    return;
  }

  /* LiveScore-style Match Center tabs */
  const matchTabBtn = e.target.closest("[data-match-tab]");
  if (matchTabBtn) {
    document.querySelectorAll("#matchCenterTabs .sub-tab-btn").forEach((b) => b.classList.remove("active"));
    matchTabBtn.classList.add("active");
    const t = matchTabBtn.dataset.matchTab;
    document.getElementById("matchTab-summary").style.display = t === "summary" ? "" : "none";
    document.getElementById("matchTab-stats").style.display = t === "stats" ? "" : "none";
    document.getElementById("matchTab-lineups").style.display = t === "lineups" ? "" : "none";
    document.getElementById("matchTab-table").style.display = t === "table" ? "" : "none";
    document.getElementById("matchTab-h2h").style.display = t === "h2h" ? "" : "none";
    document.getElementById("matchTab-pred").style.display = t === "pred" ? "" : "none";
    return;
  }

  /* Summary sub-tabs (Events vs Commentary) */
  if (e.target.id === "btnSummaryEvents") {
    document.getElementById("btnSummaryEvents").classList.add("active");
    document.getElementById("btnSummaryCommentary").classList.remove("active");
    document.getElementById("summaryEventsContainer").style.display = "";
    document.getElementById("summaryCommentaryContainer").style.display = "none";
    return;
  }
  if (e.target.id === "btnSummaryCommentary") {
    document.getElementById("btnSummaryCommentary").classList.add("active");
    document.getElementById("btnSummaryEvents").classList.remove("active");
    document.getElementById("summaryEventsContainer").style.display = "none";
    document.getElementById("summaryCommentaryContainer").style.display = "";
    return;
  }

  /* League accordion toggle */
  const leagueHead = e.target.closest("[data-toggle-league]");
  if (leagueHead) {
    const card = leagueHead.closest(".league-card");
    if (card) card.classList.toggle("open");
    return;
  }

  /* Completed jackpot accordion toggle (expands to settlement breakdown) */
  const jpAccordionHead = e.target.closest("[data-toggle-jackpot-accordion]");
  if (jpAccordionHead) {
    toggleCompletedAccordion(jpAccordionHead.dataset.toggleJackpotAccordion);
    return;
  }

  /* Favorite/follow team star toggle */
  const favStar = e.target.closest("[data-toggle-favorite]");
  if (favStar) {
    const teamId = Number(favStar.dataset.toggleFavorite);
    const teamName = favStar.dataset.teamName;
    toggleFavoriteTeam(teamId, teamName);
    // Instant feedback on every star for this same team on screen (a
    // team can appear in both the fixtures list and a jackpot card, etc.)
    // rather than waiting on a full re-render.
    document.querySelectorAll(`[data-toggle-favorite="${teamId}"]`).forEach((star) => {
      const nowActive = star.classList.toggle("active");
      star.textContent = nowActive ? "★" : "☆";
      star.title = nowActive ? "Following" : "Follow this team";
    });
    return;
  }

  /* Open Match Center modal */
  const matchTrigger = e.target.closest("[data-open-match]");
  if (matchTrigger) {
    openMatchCenter(matchTrigger.dataset.openMatch);
    return;
  }

  /* Open Jackpot modal */
  const jackpotTrigger = e.target.closest("[data-open-jackpot]");
  if (jackpotTrigger) {
    openJackpot(jackpotTrigger.dataset.openJackpot);
    return;
  }

  /* Open FPL Player modal */
  const fplTrigger = e.target.closest("[data-open-fpl-player]");
  if (fplTrigger) {
    try {
      openFplPlayer(JSON.parse(fplTrigger.dataset.openFplPlayer));
    } catch (err) {
      console.error("Failed to parse FPL player data", err);
    }
    return;
  }

  /* Switch FPL gameweek tab */
  const gwTrigger = e.target.closest("[data-fpl-gw]");
  if (gwTrigger) {
    loadFplSquad(Number(gwTrigger.dataset.fplGw));
    return;
  }

  /* Close modal */
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) {
    closeAnyModal(closeBtn.dataset.close);
    return;
  }

  /* Sport selector */
  const sportBtn = e.target.closest("[data-select-sport]");
  if (sportBtn) {
    state.currentSport = sportBtn.dataset.selectSport;
    document.querySelectorAll("#sportSelector .sport-btn").forEach((b) => b.classList.remove("active"));
    sportBtn.classList.add("active");
    loadFixtures();
    return;
  }

  /* News sport sub-tab */
  const newsSportBtn = e.target.closest("[data-select-news-sport]");
  if (newsSportBtn) {
    state.currentNewsSport = newsSportBtn.dataset.selectNewsSport;
    loadNews();
    return;
  }

  /* Search result click */
  const searchRes = e.target.closest("[data-search-action]");
  if (searchRes) {
    try {
      const action = JSON.parse(searchRes.dataset.searchAction);
      if (action.type === "fixture") {
        openMatchCenter(action.id);
      } else if (action.type === "team" && action.id) {
        openTeamProfile(action.id);
      } else if (action.type === "team" || action.type === "league") {
        const input = document.getElementById("searchInput");
        input.value = action.name;
        runSearch(action.name);
      }
    } catch (err) { /* ignore malformed action payload */ }
    document.getElementById("searchDropdown").classList.remove("open");
    return;
  }
});

/* Modal backdrop click-to-close */
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeAnyModal(backdrop.id);
  });
});

/* Search input */
const searchInput = document.getElementById("searchInput");
if (searchInput) {
  searchInput.addEventListener("input", (e) => runSearch(e.target.value));
  searchInput.addEventListener("focus", (e) => {
    if (e.target.value.trim().length >= 2) runSearch(e.target.value);
  });
}

/* Date picker */
const datePicker = document.getElementById("datePicker");
if (datePicker) {
  datePicker.value = state.currentDate;
  datePicker.addEventListener("change", (e) => {
    state.currentDate = e.target.value;
    loadFixtures();
  });
}

/* Unlock payment submit */
const unlockSubmit = document.getElementById("unlockSubmit");
if (unlockSubmit) unlockSubmit.addEventListener("click", submitUnlock);

/* ============ INITIAL LOAD ============ */
async function init() {
  await loadSports();
  await loadFixtures();
  await loadStats();
  await loadBestBet();
  await loadAccuracy();
  await loadNews();
  await loadFplSquad();
  connectLiveStream();
}

init();

/* ============ PWA: register service worker ============ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.warn("[pwa] service worker registration failed (non-fatal):", err);
    });
  });
}
