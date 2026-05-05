// Service worker for the NorCal Touge Spots 3D map.
// Strategy:
//   - HTML / JS / CSS: stale-while-revalidate (always fast, refresh in background)
//   - JSON data files (routes, tilden_holes, bay_buildings, bay_forest):
//     same — cached aggressively
//   - Cesium CDN tiles + image tiles: never cached by us; let the browser cache them
//
// Bumping CACHE_VERSION drops all old entries on next activation.

const CACHE_VERSION = "v1-2026-05-04";
const PRECACHE = [
  "./",
  "./3d.html",
  "./index.html",
  "./food.html",
  "./app-3d.js",
  "./app.js",
  "./food.js",
  "./styles.css",
  "./routes.json",
  "./food.json",
  "./tilden_holes.json",
  "./bay_buildings.json",
  "./bay_forest.json",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only handle same-origin GET requests
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Stale-while-revalidate
  e.respondWith(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.match(e.request).then((cached) => {
        const fetchPromise = fetch(e.request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(e.request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      });
    })
  );
});
