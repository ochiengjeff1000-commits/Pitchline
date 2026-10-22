// Bump this on every deploy that changes any cached file — old caches are
// deleted on activate, so this is the only thing that forces a refresh.
const CACHE_VERSION = "pitchline-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_FALLBACK_CACHE = `${CACHE_VERSION}-api-fallback`;

// The app shell — static files that rarely change. Cached eagerly on
// install so the app opens instantly on repeat visits and still opens
// (to a usable, if stale, screen) with no signal at all — genuinely
// useful in Kenya's patchy-matatu-wifi reality, not just a PWA checkbox.
const SHELL_FILES = [
  "/", "/index.html", "/manifest.json",
  "/css/styles.css", "/css/admin.css",
  "/js/main.js", "/js/state.js", "/js/api.js", "/js/utils.js", "/js/constants.js",
  "/js/fixtures.js", "/js/live.js", "/js/matchCenter.js", "/js/teamProfile.js",
  "/js/jackpots.js", "/js/news.js", "/js/search.js", "/js/fpl.js",
  "/js/trackRecord.js", "/js/favorites.js", "/js/demoData.js",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch((err) => console.warn("[sw] shell precache failed (non-fatal):", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept POST (unlock payments, admin actions, etc.)

  const url = new URL(request.url);

  // Live scores stream (SSE) and anything cross-origin: never intercept —
  // an SSE connection cached/proxied through the service worker would
  // just break the live-update pipeline.
  if (url.origin !== self.location.origin || url.pathname === "/api/live/stream") return;

  if (isApiRequest(url)) {
    // Network-first: live scores, predictions, and jackpots must always be
    // as fresh as possible. Only fall back to a cached copy — clearly
    // marked stale by the frontend, see api.js — when the network request
    // genuinely fails (offline, or a bad connection dropping the request).
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(API_FALLBACK_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell: stale-while-revalidate — serve instantly from cache, then
  // quietly refresh the cache in the background for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
