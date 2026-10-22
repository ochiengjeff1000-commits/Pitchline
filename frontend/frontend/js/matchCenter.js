import { state } from "./state.js";
import { api } from "./api.js";
import { esc, pickLabel, isFixtureLive, momentumEventIcon, confidenceTier, formatLiveClock } from "./utils.js";

export function findFixtureById(id) {
  id = String(id);
  for (const l of state.allLoadedLeagues) {
    for (const f of l.fixtures) {
      if (String(f.id) === id) return { fixture: f, league: l };
    }
  }
  return null;
}

function renderStatRow(title, homeVal, awayVal) {
  const h = Number(homeVal) || 0;
  const a = Number(awayVal) || 0;
  const total = (h + a) || 1;
  const homePct = Math.round((h / total) * 100);

  return `
    <div class="stat-row">
      <div class="stat-labels">
        <span class="val-home">${homeVal}</span>
        <span class="stat-title">${esc(title)}</span>
        <span class="val-away">${awayVal}</span>
      </div>
      <div class="stat-bar-container">
        <div class="stat-bar-fill home" style="width:${homePct}%;"></div>
        <div class="stat-bar-fill away" style="width:${100 - homePct}%;"></div>
      </div>
    </div>`;
}

// Sports where the box score is fundamentally football-shaped (shots,
// corners, possession, cards). Everything else (basketball, hockey,
// baseball, NFL, rugby, handball, AFL, volleyball) doesn't have these
// concepts at all, and PitchLine doesn't currently ingest a
// sport-appropriate replacement stat set (e.g. rebounds/assists,
// shots-on-goal, hits/errors) — so rather than rendering misleading
// zeroed football stat rows for those sports, show the score/period
// state honestly and say so.
const FOOTBALL_LIKE_STATS_SPORTS = new Set(["FOOTBALL"]);

function renderLiveScoreStats(stats, sport) {
  const container = document.getElementById("matchTab-stats");

  if (!FOOTBALL_LIKE_STATS_SPORTS.has(sport)) {
    container.innerHTML = `<div class="momentum-empty">Detailed box score stats aren't tracked for this sport yet — check the Summary tab for the live score and period.</div>`;
    return;
  }

  if (!stats || stats.available === false) {
    container.innerHTML = `<div class="momentum-empty">Match statistics will update as the fixture progresses.</div>`;
    return;
  }

  container.innerHTML = `
    ${renderStatRow("Ball Possession", stats.possession?.[0] ?? "50%", stats.possession?.[1] ?? "50%")}
    ${renderStatRow("Shots on Target", stats.shotsOnTarget?.[0] ?? 0, stats.shotsOnTarget?.[1] ?? 0)}
    ${renderStatRow("Total Shots", stats.shotsTotal?.[0] ?? 0, stats.shotsTotal?.[1] ?? 0)}
    ${renderStatRow("Corner Kicks", stats.corners?.[0] ?? 0, stats.corners?.[1] ?? 0)}
    ${renderStatRow("Fouls", stats.fouls?.[0] ?? 0, stats.fouls?.[1] ?? 0)}
    ${renderStatRow("Yellow Cards", stats.yellowCards?.[0] ?? 0, stats.yellowCards?.[1] ?? 0)}
    ${renderStatRow("Red Cards", stats.redCards?.[0] ?? 0, stats.redCards?.[1] ?? 0)}
  `;
}

function renderMatchScoreboard(f, league) {
  const wrap = document.getElementById("matchScoreboardWrap");

  let statusBadgeHtml = "";
  if (f.status === "HT" || f.status === "HALFTIME") {
    statusBadgeHtml = `<span class="fx-minute-badge ht"><span class="dot"></span>Half Time</span>`;
  } else if (isFixtureLive(f)) {
    statusBadgeHtml = `<span class="fx-minute-badge live"><span class="dot"></span>${formatLiveClock(f)}</span>`;
  } else if (f.status === "FT" || f.status === "FINISHED") {
    // "Full Time" is a football-specific term — basketball/hockey/
    // baseball/NFL etc. call a finished game "Final" instead.
    statusBadgeHtml = `<span class="fx-minute-badge ft">${f.sport && f.sport !== "FOOTBALL" ? "Final" : "Full Time"}</span>`;
  } else {
    const kickoff = new Date(f.kickoff);
    const timeStr = kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    statusBadgeHtml = `<span class="fx-minute-badge scheduled">${timeStr}</span>`;
  }

  const homeLogo = f.homeTeam?.logoUrl ? `<img src="${esc(f.homeTeam.logoUrl)}" width="40" height="40" alt="" style="object-fit:contain;" onerror="this.style.display='none'">` : "";
  const awayLogo = f.awayTeam?.logoUrl ? `<img src="${esc(f.awayTeam.logoUrl)}" width="40" height="40" alt="" style="object-fit:contain;" onerror="this.style.display='none'">` : "";

  const hScore = (f.homeScore != null) ? f.homeScore : 0;
  const aScore = (f.awayScore != null) ? f.awayScore : 0;
  const scoreDisplay = (!isFixtureLive(f) && f.status !== "FT" && f.status !== "FINISHED" && f.homeScore == null) ? "VS" : `${hScore} - ${aScore}`;

  wrap.innerHTML = `
    <div class="match-header-card">
      <div class="match-header-league">${esc(league?.name || "Match Center")}${league?.country ? " · " + esc(league.country) : ""}</div>
      <div class="match-scoreboard">
        <div class="scoreboard-team">
          ${homeLogo}
          <span class="t-name">${esc(f.homeTeam?.name || "Home")}</span>
        </div>
        <div class="scoreboard-center">
          <div class="scoreboard-score">${scoreDisplay}</div>
          ${statusBadgeHtml}
        </div>
        <div class="scoreboard-team">
          ${awayLogo}
          <span class="t-name">${esc(f.awayTeam?.name || "Away")}</span>
        </div>
      </div>
    </div>`;
}

function renderMomentumPane(data, homeName, awayName) {
  const eventsPane = document.getElementById("summaryEventsContainer");
  const commPane = document.getElementById("summaryCommentaryContainer");
  const pitchStats = document.getElementById("pitchOverlayStats");

  const hScore = (data.homeScore != null) ? data.homeScore : (state.currentActiveFixture?.homeScore != null ? state.currentActiveFixture.homeScore : 0);
  const aScore = (data.awayScore != null) ? data.awayScore : (state.currentActiveFixture?.awayScore != null ? state.currentActiveFixture.awayScore : 0);
  const statusText = data.status || state.currentActiveFixture?.status || "";
  const minText = data.clockMinute ? `${data.clockMinute}'` : (state.currentActiveFixture ? formatLiveClock(state.currentActiveFixture) : statusText);

  const stats = data.stats;
  const havePitchStats = stats && stats.available !== false;

  const scoreUnitLabel = { BASKETBALL: "Points", HOCKEY: "Goals", BASEBALL: "Runs", NFL: "Points", RUGBY: "Points", AFL: "Points", HANDBALL: "Goals", VOLLEYBALL: "Points" }[state.currentActiveFixture?.sport] || "Goals";

  pitchStats.innerHTML = `
    <div class="pitch-overlay-title">${statusText === "HT" ? "Half Time" : statusText === "FT" ? (state.currentActiveFixture?.sport && state.currentActiveFixture.sport !== "FOOTBALL" ? "Final" : "Full Time") : "Live Action"}</div>
    <div class="pitch-stat-row"><span class="pitch-stat-val">${hScore}</span><span class="pitch-stat-label">${scoreUnitLabel}</span><span class="pitch-stat-val">${aScore}</span></div>
    ${havePitchStats ? `
      <div class="pitch-stat-row"><span class="pitch-stat-val">${stats.possession?.[0] ?? "—"}</span><span class="pitch-stat-label">Possession</span><span class="pitch-stat-val">${stats.possession?.[1] ?? "—"}</span></div>
      <div class="pitch-stat-row"><span class="pitch-stat-val">${stats.shotsOnTarget?.[0] ?? 0}</span><span class="pitch-stat-label">Shots On Target</span><span class="pitch-stat-val">${stats.shotsOnTarget?.[1] ?? 0}</span></div>
      <div class="pitch-stat-row"><span class="pitch-stat-val">${stats.corners?.[0] ?? 0}</span><span class="pitch-stat-label">Corners Won</span><span class="pitch-stat-val">${stats.corners?.[1] ?? 0}</span></div>
    ` : `<div class="pitch-stat-row"><span class="pitch-stat-label">LIVE STATS AREN'T PUBLISHED FOR THIS FIXTURE'S DATA SOURCE YET.</span></div>`}
  `;

  if (!data || !data.timeline || data.timeline.length === 0) {
    eventsPane.innerHTML = `<div class="momentum-empty">No key match events logged for this fixture yet.</div>`;
  } else {
    const m = data.momentum || 0;
    const widthPct = Math.abs(m) * 50;
    const leftPct = m >= 0 ? 50 : 50 - widthPct;

    const timelineHtml = data.timeline.slice().reverse().map((ev) => `
      <div class="momentum-event">
        <span class="minute">${ev.minute}'</span>
        <span class="side-tag ${ev.side}"></span>
        <span class="detail">${momentumEventIcon(ev.type)} <b>${esc(ev.player || "")}</b> ${esc(ev.detail ? "— " + ev.detail : "")} ${ev.runningScore ? `<span class="mono" style="color:var(--floodlight-400);font-weight:700;margin-left:6px;">${ev.runningScore}</span>` : ""}</span>
      </div>`).join("");

    eventsPane.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
        <div style="font-weight:700;font-size:12px;color:var(--slate-400);text-transform:uppercase;">Match Momentum</div>
        <div class="mono" style="font-weight:700;">${hScore} - ${aScore} <span style="color:var(--slate-500);font-weight:400;">· ${minText}</span></div>
      </div>
      <div class="momentum-bar-track">
        <div class="momentum-bar-mid"></div>
        <div class="momentum-bar-fill" style="left:${leftPct}%;width:${widthPct}%;"></div>
      </div>
      <div class="momentum-labels"><span>${esc(homeName)}</span><span>${esc(awayName)}</span></div>
      <div class="momentum-timeline">${timelineHtml}</div>`;
  }

  if (data.commentary && data.commentary.length > 0) {
    commPane.innerHTML = data.commentary.map((c) => `
      <div class="commentary-item">
        <span class="c-min">${c.minute}'</span>
        <span class="c-text">${esc(c.text)}</span>
      </div>`).join("");
  } else {
    commPane.innerHTML = `<div class="momentum-empty">Live commentary feed will appear during active play.</div>`;
  }

  renderLiveScoreStats(stats, state.currentActiveFixture?.sport);
}

async function loadLiveEventsAndMomentum(fixtureId, homeName, awayName) {
  const isLive = isFixtureLive(state.currentActiveFixture);

  // ONLY call live endpoints if the fixture is currently in active play
  let eventsData = null;
  let statsData = null;

  if (isLive) {
    [eventsData, statsData] = await Promise.all([
      api(`/api/fixtures/${fixtureId}/live-events`),
      api(`/api/fixtures/${fixtureId}/stats`),
    ]);
  }

  const liveData = eventsData || {
    momentum: state.currentActiveFixture?.momentum ?? 0,
    homeScore: state.currentActiveFixture?.homeScore,
    awayScore: state.currentActiveFixture?.awayScore,
    clockMinute: state.currentActiveFixture?.clockMinute,
    status: state.currentActiveFixture?.status,
    timeline: state.currentActiveFixture?.events || [],
    commentary: state.currentActiveFixture?.commentary || [],
  };
  liveData.stats = statsData;

  renderMomentumPane(liveData, homeName, awayName);
}

async function loadLineupsAndTable(fixtureId) {
  const lineupsData = await api(`/api/fixtures/${fixtureId}/lineups`);
  const lineupsEl = document.getElementById("matchTab-lineups");
  if (lineupsData && lineupsData.available !== false && lineupsData.home && lineupsData.away) {
    lineupsEl.innerHTML = `
      <div class="lineup-col">
        <h5>${esc(lineupsData.home.team)} (${esc(lineupsData.home.formation || "Starting XI")})</h5>
        ${(lineupsData.home.startXI || []).map((p) => `<div class="lineup-player"><span><span class="num">${p.number || ""}</span>${esc(p.name)}</span><span>${esc(p.pos || "")}</span></div>`).join("")}
      </div>
      <div class="lineup-col">
        <h5>${esc(lineupsData.away.team)} (${esc(lineupsData.away.formation || "Starting XI")})</h5>
        ${(lineupsData.away.startXI || []).map((p) => `<div class="lineup-player"><span><span class="num">${p.number || ""}</span>${esc(p.name)}</span><span>${esc(p.pos || "")}</span></div>`).join("")}
      </div>`;
  } else {
    lineupsEl.innerHTML = `<div class="momentum-empty" style="grid-column:1/-1;">Official team line-ups will appear closer to kickoff.</div>`;
  }
}

function formBar(label, form) {
  const scale = Math.min((form?.avgScored || 0) / 4, 1) * 100;
  const badges = (form?.recent || []).map((r) => `<span class="form-badge form-${r.toLowerCase()}">${r}</span>`).join("");
  return `
    <div class="form-row"><span class="name">${esc(label)}</span>
      <div class="form-bar-track"><div class="form-bar-fill" style="width:${scale}%"></div></div>
      <span class="mono" style="width:70px;font-size:11px;color:var(--slate-400);">${form?.avgScored ?? 0} / ${form?.avgConceded ?? 0}</span>
    </div>
    ${badges ? `<div class="form-badges">${badges}</div>` : ""}`;
}

async function loadH2hAndForm(fixtureId, homeName, awayName, prediction) {
  const insights = await api(`/api/fixtures/${fixtureId}/insights`) || {
    homeTeam: homeName, awayTeam: awayName,
    form: { home: { avgScored: 0, avgConceded: 0, recent: [] }, away: { avgScored: 0, avgConceded: 0, recent: [] } },
    h2h: { meetings: 0, homeWins: 0, draws: 0, awayWins: 0, recent: [] },
    prediction: prediction || null,
  };

  const meetingsHtml = (insights.h2h?.recent || []).map((m) => {
    const d = new Date(m.kickoff);
    const dateStr = d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
    return `
      <div class="h2h-meeting-row">
        <span class="h2h-meeting-meta">${dateStr} · ${esc(m.competition || "")}</span>
        <span class="h2h-meeting-score">${m.homeScore ?? "-"} - ${m.awayScore ?? "-"}</span>
      </div>`;
  }).join("");

  const h2hEl = document.getElementById("matchTab-h2h");
  h2hEl.innerHTML = `
    <div class="insight-block" style="margin-top:12px;">
      <h4>Recent Form (Goals Scored / Conceded)</h4>
      ${formBar(insights.homeTeam, insights.form?.home)}
      ${formBar(insights.awayTeam, insights.form?.away)}
    </div>
    <div class="insight-block">
      <h4>Head-To-Head (Last ${insights.h2h?.meetings ?? 0} Matches)</h4>
      <div class="h2h-row"><span>${esc(insights.homeTeam)} Wins</span><b>${insights.h2h?.homeWins ?? 0}</b></div>
      <div class="h2h-row"><span>Draws</span><b>${insights.h2h?.draws ?? 0}</b></div>
      <div class="h2h-row"><span>${esc(insights.awayTeam)} Wins</span><b>${insights.h2h?.awayWins ?? 0}</b></div>
    </div>
    ${meetingsHtml ? `<div class="insight-block"><h4>Previous Meetings</h4>${meetingsHtml}</div>` : ""}`;

  const predEl = document.getElementById("matchTab-pred");
  const p = insights.prediction;
  if (!p) {
    predEl.innerHTML = `<div class="empty-state">No prediction generated for this fixture yet.</div>`;
  } else {
    const hasFootballMarkets = p.correctScoreTop3 != null;
    const pct = (v) => Math.round((v || 0) * 100);

    const goalsMarketsHtml = hasFootballMarkets ? `
      <div class="insight-block">
        <h4>Goals Markets</h4>
        <div class="market-grid">
          <div class="market-cell"><span class="market-label">O/U 1.5</span><span class="market-val">O ${pct(p.over15Prob)}% · U ${pct(p.under15Prob)}%</span></div>
          <div class="market-cell"><span class="market-label">O/U 2.5</span><span class="market-val">O ${pct(p.over25Prob)}% · U ${pct(p.under25Prob)}%</span></div>
          <div class="market-cell"><span class="market-label">O/U 3.5</span><span class="market-val">O ${pct(p.over35Prob)}% · U ${pct(p.under35Prob)}%</span></div>
          <div class="market-cell"><span class="market-label">BTTS</span><span class="market-val">Yes ${pct(p.bttsYesProb)}% · No ${pct(p.bttsNoProb)}%</span></div>
          <div class="market-cell"><span class="market-label">Goals Odd/Even</span><span class="market-val">Odd ${pct(p.oddTotalProb)}% · Even ${pct(p.evenTotalProb)}%</span></div>
          <div class="market-cell"><span class="market-label">Clean Sheet</span><span class="market-val">${esc(insights.homeTeam)} ${pct(p.cleanSheetHomeProb)}% · ${esc(insights.awayTeam)} ${pct(p.cleanSheetAwayProb)}%</span></div>
        </div>
      </div>
      <div class="insight-block">
        <h4>Match Result Markets</h4>
        <div class="market-grid">
          <div class="market-cell"><span class="market-label">Double Chance</span><span class="market-val">1X ${pct(p.doubleChance1XProb)}% · 12 ${pct(p.doubleChance12Prob)}% · X2 ${pct(p.doubleChanceX2Prob)}%</span></div>
          <div class="market-cell"><span class="market-label">Draw No Bet</span><span class="market-val">${esc(insights.homeTeam)} ${pct(p.dnbHomeProb)}% · ${esc(insights.awayTeam)} ${pct(p.dnbAwayProb)}%</span></div>
        </div>
      </div>
      ${p.correctScoreTop3?.length ? `
      <div class="insight-block">
        <h4>Most Likely Scorelines</h4>
        <div class="score-picks">
          ${p.correctScoreTop3.map((s, i) => `<div class="score-pick ${i === 0 ? "top" : ""}"><span class="score">${s.home}-${s.away}</span><span class="pct">${pct(s.prob)}%</span></div>`).join("")}
        </div>
      </div>` : ""}` : "";

    predEl.innerHTML = `
      <div class="insight-block" style="margin-top:12px;">
        <h4>${hasFootballMarkets ? "Algorithmic Win Probability" : "Win Probability"}</h4>
        <div class="prob-bars">
          <div class="prob-seg" style="flex:${p.probHome || 0};background:var(--teal-400);">${pct(p.probHome)}%</div>
          ${p.probDraw ? `<div class="prob-seg" style="flex:${p.probDraw};background:var(--slate-400);">${pct(p.probDraw)}%</div>` : ""}
          <div class="prob-seg" style="flex:${p.probAway || 0};background:var(--floodlight-400);">${pct(p.probAway)}%</div>
        </div>
      </div>
      <div class="insight-block">
        <h4>Model Pick &amp; Recommendation</h4>
        <div style="font-size:13px;line-height:1.6;color:var(--chalk-100);background:var(--pitch-800);padding:12px;border-radius:9px;border:1px solid var(--border);">
          Predicted Outcome: <b>${pickLabel(p.predictedOutcome)}</b> <span class="conf-badge ${confidenceTier(p.confidence).cls}">${confidenceTier(p.confidence).label}</span><br>
          ${p.predictedHomeGoals != null && p.predictedAwayGoals != null ? `Most Likely Scoreline: <b>${p.predictedHomeGoals} - ${p.predictedAwayGoals}</b><br>` : ""}
          Model Confidence: <b>${pct(p.confidence)}%</b><br>
          <span style="color:var(--slate-400);font-size:12px;">${esc(p.justification || "")}</span>
        </div>
      </div>
      ${goalsMarketsHtml}`;
  }
}

export async function openMatchCenter(fixtureId) {
  const found = findFixtureById(fixtureId);
  let fixture = found?.fixture;
  let league = found?.league;

  if (!fixture) {
    const fetched = await api(`/api/fixtures/${fixtureId}`);
    fixture = fetched || { id: fixtureId, kickoff: new Date().toISOString(), status: "SCHEDULED", homeTeam: { name: "Home Team" }, awayTeam: { name: "Away Team" }, homeScore: null, awayScore: null };
  }

  state.currentActiveFixture = fixture;
  renderMatchScoreboard(fixture, league);

  document.querySelectorAll("#matchCenterTabs .sub-tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('#matchCenterTabs [data-match-tab="summary"]').classList.add("active");

  document.getElementById("matchTab-summary").style.display = "";
  document.getElementById("matchTab-stats").style.display = "none";
  document.getElementById("matchTab-lineups").style.display = "none";
  document.getElementById("matchTab-table").style.display = "none";
  document.getElementById("matchTab-h2h").style.display = "none";
  document.getElementById("matchTab-pred").style.display = "none";

  document.getElementById("matchCenterModal").classList.add("open");

  loadLiveEventsAndMomentum(fixture.id, fixture.homeTeam.name, fixture.awayTeam.name);
  loadH2hAndForm(fixture.id, fixture.homeTeam.name, fixture.awayTeam.name, fixture.prediction);
  loadLineupsAndTable(fixture.id);

  // Clear existing polling timer
  if (state.matchModalTimer) {
    clearInterval(state.matchModalTimer);
    state.matchModalTimer = null;
  }

  // ONLY poll for updates if the fixture is currently LIVE
  if (isFixtureLive(fixture)) {
    state.matchModalTimer = setInterval(() => {
      if (!document.getElementById("matchCenterModal").classList.contains("open")) {
        clearInterval(state.matchModalTimer);
        state.matchModalTimer = null;
        return;
      }
      loadLiveEventsAndMomentum(fixture.id, fixture.homeTeam.name, fixture.awayTeam.name);
    }, 15000);
  }
}

export function stopMatchCenterPolling() {
  if (state.matchModalTimer) {
    clearInterval(state.matchModalTimer);
    state.matchModalTimer = null;
  }
}