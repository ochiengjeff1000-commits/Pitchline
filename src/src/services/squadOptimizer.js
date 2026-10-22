const prisma = require("../lib/prisma");

const BUDGET_TENTHS = 1000; // £100.0m
const SQUAD_SHAPE = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const MAX_PER_CLUB = 3;
const FIXTURE_HORIZON_GWS = 3;

// Valid starting-XI formations (GKP is always 1, handled separately).
const FORMATIONS = [
  { DEF: 3, MID: 4, FWD: 3 }, { DEF: 3, MID: 5, FWD: 2 }, { DEF: 4, MID: 4, FWD: 2 },
  { DEF: 4, MID: 3, FWD: 3 }, { DEF: 4, MID: 5, FWD: 1 }, { DEF: 5, MID: 3, FWD: 2 },
  { DEF: 5, MID: 4, FWD: 1 },
];

/**
 * Blends form + FPL's own next-gameweek expected-points estimate + our
 * own multi-gameweek fixture-difficulty adjustment into one xPts score.
 */
function computeXPts(player, fixturesByTeam) {
  const base = player.epNext || player.form || 0;
  const upcoming = (fixturesByTeam.get(player.teamName) || []).slice(0, FIXTURE_HORIZON_GWS);
  if (upcoming.length === 0) return round(base);

  const avgDifficulty =
    upcoming.reduce((sum, f) => sum + (f.homeTeamName === player.teamName ? f.homeDifficulty : f.awayDifficulty), 0) /
    upcoming.length;

  const difficultyMultiplier = Math.max(0.7, Math.min(1.3, 1 + (3 - avgDifficulty) * 0.08));
  return round(base * difficultyMultiplier * FIXTURE_HORIZON_GWS);
}

function round(n) { return Math.round(n * 100) / 100; }

/**
 * Greedy budget-constrained squad builder with strict position validation.
 */
function pickSquad(playersByPosition) {
  const squad = [];
  const clubCounts = new Map();
  let spent = 0;

  const positionOrder = ["GKP", "DEF", "MID", "FWD"];
  for (const pos of positionOrder) {
    const need = SQUAD_SHAPE[pos];
    const candidates = [...playersByPosition[pos]].sort((a, b) => (b.xPts / b.priceTenths) - (a.xPts / a.priceTenths));
    let filled = 0;

    for (const player of candidates) {
      if (filled >= need) break;
      const club = player.teamName;
      if ((clubCounts.get(club) || 0) >= MAX_PER_CLUB) continue;

      const remainingSlotsAfterThis =
        need - filled - 1 + positionOrder.slice(positionOrder.indexOf(pos) + 1).reduce((s, p) => s + SQUAD_SHAPE[p], 0);
      const reserve = remainingSlotsAfterThis * 40; // ~£4.0m floor per remaining slot
      if (spent + player.priceTenths + reserve > BUDGET_TENTHS) continue;

      squad.push(player);
      clubCounts.set(club, (clubCounts.get(club) || 0) + 1);
      spent += player.priceTenths;
      filled += 1;
    }

    if (filled < need) {
      throw new Error(`Could not fill position ${pos}: required ${need}, but only found ${filled} valid players within budget and club limits.`);
    }
  }

  return { squad, spent };
}

function bestStartingXI(squad) {
  const byPos = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const p of squad) byPos[p.position].push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => b.xPts - a.xPts);

  const gk = byPos.GKP[0];
  let best = null;

  for (const formation of FORMATIONS) {
    const def = byPos.DEF.slice(0, formation.DEF);
    const mid = byPos.MID.slice(0, formation.MID);
    const fwd = byPos.FWD.slice(0, formation.FWD);
    if (def.length < formation.DEF || mid.length < formation.MID || fwd.length < formation.FWD) continue;

    const starters = [gk, ...def, ...mid, ...fwd];
    const totalXPts = starters.reduce((s, p) => s + p.xPts, 0);
    if (!best || totalXPts > best.totalXPts) {
      best = { formation, starters, totalXPts };
    }
  }

  return best;
}

/**
 * Builds the weekly "PitchLine XI" recommendation and stores it[cite: 21].
 */
async function generateSquadRecommendation(gameweek) {
  const [players, fixtures] = await Promise.all([
    prisma.fplPlayer.findMany({ where: { status: "a" } }),
    prisma.fplFixture.findMany({ where: { gameweek: { gte: gameweek } }, orderBy: { gameweek: "asc" } }),
  ]);

  const fixturesByTeam = new Map();
  for (const f of fixtures) {
    if (!fixturesByTeam.has(f.homeTeamName)) fixturesByTeam.set(f.homeTeamName, []);
    if (!fixturesByTeam.has(f.awayTeamName)) fixturesByTeam.set(f.awayTeamName, []);
    fixturesByTeam.get(f.homeTeamName).push(f);
    fixturesByTeam.get(f.awayTeamName).push(f);
  }

  // THIS week's specific opponent (distinct from the multi-gameweek
  // horizon above, which is used only for the xPts fixture-difficulty
  // adjustment). Note: a team with a blank gameweek has no entry here;
  // a double-gameweek team keeps only the first fixture found — good
  // enough for the "who do they play this week" display, not meant to
  // be a full DGW-aware scoring model.
  const opponentByTeam = new Map();
  for (const f of fixtures) {
    if (f.gameweek !== gameweek) continue;
    if (!opponentByTeam.has(f.homeTeamName)) opponentByTeam.set(f.homeTeamName, { opponent: f.awayTeamName, isHome: true });
    if (!opponentByTeam.has(f.awayTeamName)) opponentByTeam.set(f.awayTeamName, { opponent: f.homeTeamName, isHome: false });
  }

  const scored = players.map((p) => ({ ...p, xPts: computeXPts(p, fixturesByTeam) }));
  const byPosition = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const p of scored) if (byPosition[p.position]) byPosition[p.position].push(p);

  const { squad, spent } = pickSquad(byPosition);
  const xi = bestStartingXI(squad);
  if (!xi) throw new Error("Could not assemble a valid starting XI from the pool");

  const startingIds = new Set(xi.starters.map((p) => p.id));
  const sortedStarters = [...xi.starters].sort((a, b) => b.xPts - a.xPts);
  const captain = sortedStarters[0];
  const vice = sortedStarters[1];

  const squadJson = squad.map((p) => {
    const cleanPhotoId = p.photoId ? String(p.photoId).replace(/\.jpg$/, '') : null;
    const thisWeek = opponentByTeam.get(p.teamName);

    return {
      fplPlayerId: p.fplId,
      name: `${p.firstName} ${p.lastName}`,
      teamName: p.teamName,
      position: p.position,
      priceTenths: p.priceTenths,
      photoId: p.photoId,
      photoUrl: cleanPhotoId 
        ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${cleanPhotoId}.png` 
        : null,
      isStarting: startingIds.has(p.id),
      isCaptain: p.id === captain.id,
      isVice: p.id === vice.id,
      xPts: p.xPts,
      opponent: thisWeek?.opponent ?? null, // null = blank gameweek, no fixture this week
      isHome: thisWeek?.isHome ?? null,
      justification: buildJustification(p, fixturesByTeam),
    };
  });

  const record = await prisma.fplSquadRecommendation.upsert({
    where: { gameweek },
    update: {
      totalCostTenths: spent,
      totalXPts: round(xi.totalXPts),
      formation: formationLabel(xi.formation),
      explanation: buildSquadExplanation(xi, captain, vice, spent),
      squad: squadJson,
    },
    create: {
      gameweek,
      totalCostTenths: spent,
      totalXPts: round(xi.totalXPts),
      formation: formationLabel(xi.formation),
      explanation: buildSquadExplanation(xi, captain, vice, spent),
      squad: squadJson,
    },
  });

  return record;
}

function formationLabel(formation) {
  return `${formation.DEF}-${formation.MID}-${formation.FWD}`;
}

/**
 * The squad-level "why this XI" writeup shown directly below the TOTW
 * grid on the frontend — separate from each player's individual
 * justification, this explains the shape and headline picks as a whole.
 */
function buildSquadExplanation(xi, captain, vice, spentTenths) {
  const budgetLeft = round((BUDGET_TENTHS - spentTenths) / 10);
  const avgXPts = round(xi.totalXPts / xi.starters.length);
  const formation = formationLabel(xi.formation);

  const shapeNote =
    xi.formation.DEF >= 5
      ? "a defense-heavy shape, favouring clean-sheet potential and cheaper enablers over a third forward"
      : xi.formation.FWD >= 3
        ? "an attack-heavy shape, prioritizing goal threat over defensive depth"
        : "a balanced shape spreading risk across the pitch rather than loading up on one line";

  return (
    `This week's XI plays a ${formation} — ${shapeNote}. ` +
    `Total projected points across the starting XI: ${round(xi.totalXPts)} (avg ${avgXPts}/player), ` +
    `with about £${budgetLeft}m left in the bank after the full 15-man squad. ` +
    `${captain.name} gets the armband on the strongest blend of form and fixture run this horizon` +
    `${vice ? `, with ${vice.name} as the vice-captain safety net` : ""}.`
  );
}

function buildJustification(player, fixturesByTeam) {
  const upcoming = (fixturesByTeam.get(player.teamName) || []).slice(0, FIXTURE_HORIZON_GWS);
  const avgDiff = upcoming.length
    ? round(upcoming.reduce((s, f) => s + (f.homeTeamName === player.teamName ? f.homeDifficulty : f.awayDifficulty), 0) / upcoming.length)
    : null;

  const fixtureNote = avgDiff
    ? avgDiff <= 2.5
      ? `Favourable fixture run (avg FDR ${avgDiff} over next ${upcoming.length} GWs).`
      : avgDiff >= 3.5
        ? `Tougher fixture run ahead (avg FDR ${avgDiff}) — form and price still justify inclusion.`
        : `Middling fixture difficulty (avg FDR ${avgDiff}).`
    : "Fixture list not yet available for this horizon.";

  const riskNote = player.status !== "a" ? ` Flagged status: ${player.status}.` : player.news ? ` Note: ${player.news}` : "";

  return `Form ${player.form}, £${player.priceTenths / 10}m. ${fixtureNote}${riskNote}`;
}

module.exports = { generateSquadRecommendation };