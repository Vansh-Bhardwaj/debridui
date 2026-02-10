/// <reference lib="webworker" />

// Minimal service worker for PWA installability and offline app shell caching.
// Caches the app shell on install, serves from cache first, falls back to network.

const CACHE_NAME = "debridui-v1";
const APP_SHELL = ["/dashboard", "/icon.svg", "/logo.svg"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    // Clean up old caches
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const { request } = event;

    // Only cache GET requests for same-origin navigation and static assets
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Skip API routes, auth, and external requests
    if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) return;

    // Network-first for navigation (HTML pages), cache-first for static assets
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match("/dashboard")))
        );
    } else if (url.pathname.match(/\.(js|css|svg|png|jpg|webp|woff2?)$/)) {
        event.respondWith(
            caches.match(request).then(
                (cached) =>
                    cached ||
                    fetch(request).then((response) => {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                        return response;
                    })
            )
        );
    }
});
