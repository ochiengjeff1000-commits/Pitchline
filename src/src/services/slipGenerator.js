// Gap under which two outcomes are considered "too close to call" —
// Slip B switches to a double-chance cover when the top two probabilities
// are within this range of each other.
const TIGHT_GAP_THRESHOLD = 0.15;

// Minimum probability an alternate outcome needs to count as a
// legitimate upset pick for Slip C, rather than just the least-bad option.
const UPSET_VALUE_THRESHOLD = 0.2;

function outcomeLabel(outcome) {
  return { HOME: "1", DRAW: "X", AWAY: "2" }[outcome];
}

function sortedOutcomes(prediction) {
  return [
    { outcome: "HOME", prob: prediction.probHome },
    { outcome: "DRAW", prob: prediction.probDraw },
    { outcome: "AWAY", prob: prediction.probAway },
  ].sort((a, b) => b.prob - a.prob);
}

function safePick(prediction) {
  const [top] = sortedOutcomes(prediction);
  return { pick: outcomeLabel(top.outcome), confidence: top.prob };
}

function balancedPick(prediction) {
  const [top, second] = sortedOutcomes(prediction);
  if (top.prob - second.prob >= TIGHT_GAP_THRESHOLD) {
    return { pick: outcomeLabel(top.outcome), confidence: top.prob };
  }
  // Too tight — cover both with a double chance instead of guessing.
  const pair = [top.outcome, second.outcome].sort().join("-");
  const doubleChanceMap = {
    "AWAY-HOME": "12",
    "DRAW-HOME": "1X",
    "AWAY-DRAW": "X2",
  };
  return {
    pick: doubleChanceMap[pair],
    confidence: top.prob + second.prob,
  };
}

function upsetPick(prediction) {
  const outcomes = sortedOutcomes(prediction);
  const favorite = outcomes[0];
  const alternates = outcomes
    .slice(1)
    .filter((o) => o.prob >= UPSET_VALUE_THRESHOLD)
    .sort((a, b) => b.prob - a.prob);

  if (alternates.length === 0) {
    // No alternate has real value — don't force a reckless pick, just
    // mirror the favorite and flag it as low-value for an upset slip.
    return { pick: outcomeLabel(favorite.outcome), confidence: favorite.prob, noValue: true };
  }

  const best = alternates[0];
  return { pick: outcomeLabel(best.outcome), confidence: best.prob };
}

/**
 * @param {Array<{position:number, fixture:object, prediction:object}>} selections
 * ordered by position ascending
 */
function generateSlips(selections) {
  const slipA = [];
  const slipB = [];
  const slipC = [];

  for (const { position, prediction } of selections) {
    if (!prediction) continue;
    slipA.push({ position, ...safePick(prediction) });
    slipB.push({ position, ...balancedPick(prediction) });
    slipC.push({ position, ...upsetPick(prediction) });
  }

  return {
    slipA: { label: "Safe / Favorites", selections: slipA },
    slipB: { label: "Balanced / Smart Value", selections: slipB },
    slipC: { label: "Upset / High-Odds", selections: slipC },
  };
}

module.exports = { generateSlips };
