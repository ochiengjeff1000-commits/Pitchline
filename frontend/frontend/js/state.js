/* ============ SHARED APP STATE ============
   One mutable object every module imports, so there's a single source
   of truth instead of each file keeping its own copy. */
export const state = {
  API_BASE: window.API_BASE || "",
  FREE_TEASER_COUNT: 5,

  // Demo/mock fallback data is only ever shown when running the frontend
  // straight off disk with no backend (localhost, no dev server) — real
  // deployments never silently show fake fixtures to a visitor.
  DEMO_MODE: ["localhost", "127.0.0.1", ""].includes(location.hostname),

  phoneNumber: localStorage.getItem("pl_phone") || "",
  currentJackpotId: null,
  currentSport: "FOOTBALL",
  currentNewsSport: "ALL",
  currentDate: new Date().toISOString().slice(0, 10),
  currentActiveFixture: null,
  allLoadedLeagues: [],
  matchModalTimer: null,
};
