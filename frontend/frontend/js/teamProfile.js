import { api } from "./api.js";
import { esc, openModal } from "./utils.js";
import { favoriteStarHtml } from "./favorites.js";

export async function openTeamProfile(teamId) {
  openModal("teamProfileModal");
  const bodyEl = document.getElementById("teamProfileModalBody");
  const titleEl = document.getElementById("teamProfileModalTitle");
  titleEl.textContent = "Loading…";
  bodyEl.innerHTML = `<div class="empty-state">Loading team profile…</div>`;

  const profile = await api(`/api/teams/${teamId}/profile`);
  if (!profile) {
    titleEl.textContent = "Team";
    bodyEl.innerHTML = `<div class="empty-state">Couldn't load this team's profile right now.</div>`;
    return;
  }

  titleEl.textContent = profile.name;

  const logo = profile.logoUrl ? `<img src="${esc(profile.logoUrl)}" alt="" width="48" height="48" style="object-fit:contain;" onerror="this.style.display='none'">` : "";
  const metaLine = [profile.country, profile.venue?.name, profile.venue?.city].filter(Boolean).join(" · ");

  const standingsHtml = profile.standings ? `
    <div class="insight-block">
      <h4>${esc(profile.standings.leagueName)} Standing</h4>
      <div class="h2h-row"><span>Position</span><b>#${profile.standings.rank}</b></div>
      <div class="h2h-row"><span>Played</span><b>${profile.standings.played}</b></div>
      <div class="h2h-row"><span>W-D-L</span><b>${profile.standings.win}-${profile.standings.draw}-${profile.standings.lose}</b></div>
      <div class="h2h-row"><span>Goal Difference</span><b>${profile.standings.goalsDiff > 0 ? "+" : ""}${profile.standings.goalsDiff}</b></div>
      <div class="h2h-row"><span>Points</span><b>${profile.standings.points}</b></div>
    </div>` : "";

  const recentHtml = (profile.recentGames || []).length ? `
    <div class="insight-block">
      <h4>Recent Games</h4>
      ${profile.recentGames.map((g) => `
        <div class="h2h-meeting-row">
          <span class="h2h-meeting-meta">${new Date(g.kickoff).toLocaleDateString([], { day: "2-digit", month: "short" })} · ${esc(g.competition)} · ${esc(g.homeTeam)} v ${esc(g.awayTeam)}</span>
          <span class="h2h-meeting-score">${g.homeScore ?? "-"} - ${g.awayScore ?? "-"}</span>
        </div>`).join("")}
    </div>` : "";

  const upcomingHtml = (profile.upcomingFixtures || []).length ? `
    <div class="insight-block">
      <h4>Upcoming Fixtures</h4>
      ${profile.upcomingFixtures.map((g) => `
        <div class="h2h-meeting-row" data-open-match="${g.id}" style="cursor:pointer;">
          <span class="h2h-meeting-meta">${new Date(g.kickoff).toLocaleDateString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${esc(g.competition)}</span>
          <span class="h2h-meeting-score mono" style="font-weight:600;">${esc(g.homeTeam)} v ${esc(g.awayTeam)}</span>
        </div>`).join("")}
    </div>` : "";

  const squadHtml = (profile.squad && profile.squad.length) ? `
    <div class="insight-block">
      <h4>Squad</h4>
      <div class="lineup-col" style="grid-column:1/-1;">
        ${profile.squad.map((p) => `<div class="lineup-player"><span><span class="num">${p.number ?? ""}</span>${esc(p.name)}</span><span>${esc(p.position || "")}</span></div>`).join("")}
      </div>
    </div>` : "";

  bodyEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
      ${logo}
      <div>
        <div style="font-weight:700;font-size:16px;">${esc(profile.name)}${favoriteStarHtml(profile.id, profile.name)}</div>
        ${metaLine ? `<div style="font-size:12px;color:var(--slate-400);">${esc(metaLine)}</div>` : ""}
      </div>
    </div>
    ${standingsHtml}
    ${upcomingHtml}
    ${recentHtml}
    ${squadHtml}
    ${(!standingsHtml && !upcomingHtml && !recentHtml && !squadHtml) ? `<div class="empty-state">No profile data available for this team yet.</div>` : ""}
  `;
}
