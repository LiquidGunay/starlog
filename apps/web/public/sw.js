const CACHE_VERSION = "starlog-pwa-v2";
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL_URLS = [
  "/",
  "/artifacts",
  "/notes",
  "/tasks",
  "/calendar",
  "/search",
  "/sync-center",
  "/assistant",
  "/manifest.webmanifest",
  "/icons/starlog-192.svg",
  "/icons/starlog-512.svg",
];

function shouldCache(response) {
  return Boolean(response && response.ok);
}

function isRuntimeAsset(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");
}

async function cacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);

  await Promise.all(
    APP_SHELL_URLS.map(async (url) => {
      try {
        await cache.add(url);
      } catch {
        // Best-effort precache only.
      }
    }),
  );
}

async function cleanupOldCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith("starlog-pwa-") && !name.startsWith(CACHE_VERSION))
      .map((name) => caches.delete(name)),
  );
}

async function networkFirst(request, cacheName, cacheKey = request) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (shouldCache(response)) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    if (request.mode === "navigate") {
      const pathname = new URL(request.url).pathname;
      const fallback = (await cache.match(pathname)) || (await cache.match("/"));
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (shouldCache(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  const response = cached || (await fetchPromise);
  return response || Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheAppShell()
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    cleanupOldCaches()
      .catch(() => undefined)
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate" || APP_SHELL_URLS.includes(url.pathname)) {
    const cacheKey = request.mode === "navigate" ? url.pathname : request;
    event.respondWith(networkFirst(request, APP_SHELL_CACHE, cacheKey));
    return;
  }

  if (isRuntimeAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});
