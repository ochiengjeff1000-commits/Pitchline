import { state } from "./state.js";
import { api, demoFallback } from "./api.js";
import { esc } from "./utils.js";
import { DEMO_LEAGUES, DEMO_NEWS } from "./demoData.js";

let searchDebounce = null;

function searchResultRow(icon, label, tag, action) {
  return `<div class="search-result" data-search-action='${action}'>${icon} <span>${esc(label)}</span><span class="tag mono">${esc(tag)}</span></div>`;
}

function searchDemoData(q) {
  const query = q.toLowerCase();
  const teams = [];
  const leagues = [];
  const fixtures = [];

  DEMO_LEAGUES.forEach((l) => {
    if ((l.name && l.name.toLowerCase().includes(query)) || (l.country && l.country.toLowerCase().includes(query))) {
      leagues.push({ id: l.id, name: l.name, country: l.country, sport: l.sport });
    }
    (l.fixtures || []).forEach((f) => {
      if (f.homeTeam && f.homeTeam.name.toLowerCase().includes(query)) {
        teams.push({ id: f.homeTeam.name, name: f.homeTeam.name, sport: l.sport });
      }
      if (f.awayTeam && f.awayTeam.name.toLowerCase().includes(query)) {
        teams.push({ id: f.awayTeam.name, name: f.awayTeam.name, sport: l.sport });
      }
      if ((f.homeTeam && f.homeTeam.name.toLowerCase().includes(query)) || (f.awayTeam && f.awayTeam.name.toLowerCase().includes(query))) {
        fixtures.push({ id: f.id, homeTeam: f.homeTeam.name, awayTeam: f.awayTeam.name, kickoff: f.kickoff });
      }
    });
  });

  const news = DEMO_NEWS.filter((n) => n.title.toLowerCase().includes(query) || n.source.toLowerCase().includes(query));
  const uniqueTeams = Array.from(new Map(teams.map((t) => [t.name, t])).values());

  return { teams: uniqueTeams, leagues, fixtures, news };
}

function renderSearchResults(data) {
  const dd = document.getElementById("searchDropdown");
  const groups = [];
  if (data.teams?.length) {
    groups.push(`<div class="search-group-label">Teams</div>` + data.teams.map((t) => searchResultRow("👕", t.name, t.sport, JSON.stringify({ type: "team", id: t.id, name: t.name }))).join(""));
  }
  if (data.leagues?.length) {
    groups.push(`<div class="search-group-label">Leagues</div>` + data.leagues.map((l) => searchResultRow("🏆", l.name, l.country || l.sport, JSON.stringify({ type: "league", name: l.name }))).join(""));
  }
  if (data.fixtures?.length) {
    groups.push(`<div class="search-group-label">Fixtures</div>` + data.fixtures.map((f) => searchResultRow("⚽", `${f.homeTeam} vs ${f.awayTeam}`, new Date(f.kickoff).toLocaleDateString([], { month: "short", day: "numeric" }), JSON.stringify({ type: "fixture", id: f.id }))).join(""));
  }
  if (data.news?.length) {
    groups.push(`<div class="search-group-label">News</div>` + data.news.map((n) => `<a class="search-result" href="${esc(n.url)}" target="_blank" rel="noopener">📰 <span>${esc(n.title)}</span><span class="tag mono">${esc(n.source)}</span></a>`).join(""));
  }
  dd.innerHTML = groups.length ? groups.join("") : `<div class="search-empty">No matches yet — try a different term.</div>`;
  dd.classList.add("open");
}

export function runSearch(q) {
  clearTimeout(searchDebounce);
  const dd = document.getElementById("searchDropdown");
  if (q.trim().length < 2) { dd.classList.remove("open"); return; }
  searchDebounce = setTimeout(async () => {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`) ?? demoFallback(searchDemoData(q));
    renderSearchResults(data || { teams: [], leagues: [], fixtures: [], news: [] });
  }, 250);
}
