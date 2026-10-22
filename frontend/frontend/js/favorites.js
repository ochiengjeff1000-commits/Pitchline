import { state } from "./state.js";
import { esc } from "./utils.js";

const STORAGE_KEY = "pl_favorite_teams";

function readFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeFavorites(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* localStorage unavailable (private browsing, quota) — favoriting just won't persist this session */
  }
  // Let any listening UI (star icons elsewhere on the page, the My Games
  // panel) re-render without a full page reload.
  document.dispatchEvent(new CustomEvent("pl:favorites-changed"));
}

export function isFavoriteTeam(teamId) {
  if (!teamId) return false;
  return readFavorites().some((t) => t.id === teamId);
}

export function toggleFavoriteTeam(teamId, teamName) {
  if (!teamId) return;
  const list = readFavorites();
  const idx = list.findIndex((t) => t.id === teamId);
  if (idx >= 0) list.splice(idx, 1);
  else list.push({ id: teamId, name: teamName });
  writeFavorites(list);
}

export function getFavoriteTeams() {
  return readFavorites();
}

/** A small ★ toggle button. `teamId` may be undefined for older/demo data
 * that hasn't got a team id — in that case this renders nothing rather
 * than a star that can't actually be toggled. */
export function favoriteStarHtml(teamId, teamName) {
  if (!teamId) return "";
  const active = isFavoriteTeam(teamId);
  return `<button class="fav-star ${active ? "active" : ""}" data-toggle-favorite="${teamId}" data-team-name="${esc(teamName || "")}" aria-label="${active ? "Unfollow" : "Follow"} ${esc(teamName || "team")}" title="${active ? "Following" : "Follow this team"}">${active ? "★" : "☆"}</button>`;
}

/* ============ MY GAMES PANEL ============ */

function fixtureRowMini(f) {
  const kickoff = new Date(f.kickoff);
  const timeStr = f.isLive
    ? `<span class="my-games-live">LIVE</span>`
    : f.status === "FT" || f.status === "FINISHED"
    ? "FT"
    : kickoff.toLocaleDateString([], { day: "2-digit", month: "short" }) + ", " + kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const scoreStr = f.homeScore != null ? `${f.homeScore} - ${f.awayScore}` : "vs";
  return `
    <div class="my-games-row" data-open-match="${f.id}">
      <span class="my-games-teams">${esc(f.homeTeam.name)} <span class="mono">${scoreStr}</span> ${esc(f.awayTeam.name)}</span>
      <span class="my-games-time mono">${timeStr}</span>
    </div>`;
}

/** Renders the "My Games" panel from whatever's already loaded in
 * state.allLoadedLeagues — no extra fetch, since Scores & Fixtures has
 * already pulled today's fixtures across every league by the time this
 * runs. Shows nothing (not even an empty state) when there are no
 * favorites yet, so it doesn't take up space for someone who hasn't
 * followed anything. */
export function renderMyGames() {
  const el = document.getElementById("myGamesPanel");
  if (!el) return;

  const favorites = getFavoriteTeams();
  if (favorites.length === 0) {
    el.innerHTML = "";
    return;
  }

  const favIds = new Set(favorites.map((f) => f.id));
  const matches = [];
  for (const league of state.allLoadedLeagues || []) {
    for (const f of league.fixtures) {
      if (favIds.has(f.homeTeam.id) || favIds.has(f.awayTeam.id)) matches.push(f);
    }
  }
  matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  if (matches.length === 0) {
    el.innerHTML = `
      <div class="my-games-panel">
        <div class="my-games-header">⭐ My Games <span class="my-games-count">${favorites.length} team${favorites.length > 1 ? "s" : ""} followed</span></div>
        <div class="empty-state" style="padding:10px 0;">No games for your followed teams today.</div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="my-games-panel">
      <div class="my-games-header">⭐ My Games <span class="my-games-count">${favorites.length} team${favorites.length > 1 ? "s" : ""} followed</span></div>
      ${matches.map(fixtureRowMini).join("")}
    </div>`;
}

document.addEventListener("pl:favorites-changed", renderMyGames);
