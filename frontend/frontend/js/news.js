import { state } from "./state.js";
import { api, demoFallback } from "./api.js";
import { esc } from "./utils.js";
import { SPORT_LABELS, NEWS_SPORTS } from "./constants.js";
import { DEMO_NEWS } from "./demoData.js";

function newsCard(a) {
  const when = new Date(a.publishedAt).toLocaleDateString([], { month: "short", day: "numeric" });
  const thumb = a.imageUrl ? `style="background-image:url('${esc(a.imageUrl)}')"` : "";
  return `
    <a class="news-card" href="${esc(a.url)}" target="_blank" rel="noopener">
      <div class="thumb" ${thumb}></div>
      <div class="body">
        <span class="source">${esc(a.source)}</span>
        <h4>${esc(a.title)}</h4>
        <span class="when">${when}</span>
      </div>
    </a>`;
}

function renderNewsSportTabs() {
  const el = document.getElementById("newsSportTabs");
  el.innerHTML = NEWS_SPORTS.map((s) =>
    `<button class="sport-btn${s === state.currentNewsSport ? " active" : ""}" data-select-news-sport="${s}">${s === "ALL" ? "🌐 All" : (SPORT_LABELS[s] || s)}</button>`
  ).join("");
}

export async function loadNews() {
  renderNewsSportTabs();
  const query = state.currentNewsSport === "ALL" ? "" : `?sport=${state.currentNewsSport}`;
  const articles = await api(`/api/news${query}`)
    ?? (state.currentNewsSport === "ALL" ? demoFallback(DEMO_NEWS) : null)
    ?? [];
  const el = document.getElementById("newsGrid");
  el.innerHTML = articles.length ? articles.map(newsCard).join("") : `<div class="empty-state">No cached headlines yet for this sport.</div>`;
}
