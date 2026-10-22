import { state } from "./state.js";

/**
 * Calls the real backend. Returns null on any failure — callers decide
 * what null means for them (empty state, or a demo fallback in dev).
 * Never fabricates data itself.
 */
export async function api(path, opts) {
  try {
    const res = await fetch(state.API_BASE + path, opts);
    if (!res.ok) throw new Error("bad status " + res.status);
    return await res.json();
  } catch (err) {
    console.warn("[api] request failed for", path, err.message);
    return null;
  }
}

/** Use only for local-dev convenience; never call with real user data in prod. */
export function demoFallback(demoValue) {
  return state.DEMO_MODE ? demoValue : null;
}
