function mapStatus(shortCode) {
  if (["FT", "AET", "PEN", "AOT"].includes(shortCode)) return "FINISHED";
  if (["HT", "BT"].includes(shortCode)) return "HALFTIME"; // BT = basketball/handball-style break-time
  if (
    ["1H", "2H", "ET", "LIVE", "P", "Q1", "Q2", "Q3", "Q4", "OT", "P1", "P2", "P3", "PT"].includes(
      shortCode
    )
  )
    return "LIVE";
  if (["PST", "SUSP", "INT"].includes(shortCode)) return "POSTPONED";
  if (["CANC", "ABD", "AWD", "WO"].includes(shortCode)) return "CANCELLED";
  return "SCHEDULED";
}

// football-data.org (Provider 1) uses a completely different status
// vocabulary from API-Sports (Provider 2) — this is that mapper's sibling.
function mapFootballDataStatus(status) {
  if (status === "FINISHED") return "FINISHED";
  if (status === "PAUSED") return "HALFTIME";
  if (status === "IN_PLAY") return "LIVE";
  if (status === "POSTPONED" || status === "SUSPENDED") return "POSTPONED";
  if (status === "CANCELLED") return "CANCELLED";
  return "SCHEDULED"; // SCHEDULED, TIMED
}

module.exports = { mapStatus, mapFootballDataStatus };