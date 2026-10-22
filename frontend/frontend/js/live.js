import { state } from "./state.js";
import { applyLiveDelta } from "./fixtures.js";

let source = null;
let reconnectTimer = null;

/**
 * Opens a persistent connection to /api/live/stream (server-sent events)
 * and pushes score/status/clock updates straight into the on-screen
 * fixture list and ticker as they happen — this is the piece that makes
 * the dashboard behave like LiveScore instead of only updating on a
 * manual refresh or when a match modal happens to be open.
 */
export function connectLiveStream() {
  if (typeof EventSource === "undefined") return;
  if (source) source.close();

  source = new EventSource(`${state.API_BASE}/api/live/stream`);

  source.onmessage = (evt) => {
    try {
      applyLiveDelta(JSON.parse(evt.data));
    } catch (err) {
      console.warn("[live] couldn't parse stream payload", err);
    }
  };

  source.onerror = () => {
    // EventSource retries on its own using the server's `retry:` hint,
    // but if the browser gives up entirely, force a reconnect.
    if (source && source.readyState === EventSource.CLOSED) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectLiveStream, 5000);
    }
  };
}

export function disconnectLiveStream() {
  clearTimeout(reconnectTimer);
  if (source) { source.close(); source = null; }
}
