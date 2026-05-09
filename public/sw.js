/// <reference lib="webworker" />

// Service worker for DebridUI PWA.
// Strategy:
//   - App shell precache on install (fast startup, offline-capable dashboard).
//   - Navigation: network-first, fall back to last-seen page, then the cached
//     /dashboard, then a synthesized offline screen.
//   - Next.js build assets (/_next/static/*): cache-first (immutable).
//   - Posters from TMDB/Metahub/wsrv.nl: stale-while-revalidate, 30-day cap.
//   - Trakt metadata (GET): stale-while-revalidate, 1-day cap.
//   - Everything else (API, auth, dynamic) is bypassed.

const VERSION = "debridui-v3";
const APP_SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const IMAGE_CACHE = `${VERSION}-images`;
const METADATA_CACHE = `${VERSION}-metadata`;

const APP_SHELL = ["/dashboard", "/icon.svg", "/logo.svg", "/manifest.json"];

const IMAGE_HOSTS = new Set([
    "image.tmdb.org",
    "walter.trakt.tv",
    "images.metahub.space",
    "wsrv.nl",
    "res.cloudinary.com",
    "api.ratingposterdb.com",
    "placehold.co",
]);

const METADATA_HOSTS = new Set([
    "api.trakt.tv",
    "v3-cinemeta.strem.io",
    "api.themoviedb.org",
    "api.tvmaze.com",
    "kitsu.io",
]);

const OFFLINE_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Offline — DebridUI</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#09090b" />
<style>
    html,body{margin:0;padding:0;background:#09090b;color:#e5e5e5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}
    .wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px;text-align:center;}
    h1{font-weight:300;font-size:clamp(1.25rem,4vw,1.75rem);margin:0;}
    p{color:#888;font-size:14px;max-width:360px;margin:0;line-height:1.5;}
    button{appearance:none;border:1px solid #333;background:transparent;color:inherit;padding:9px 16px;border-radius:3px;cursor:pointer;font:inherit;}
    button:hover{background:#171717;}
</style>
<div class="wrap">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" x2="12.01" y1="20" y2="20"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
    <h1>You're offline</h1>
    <p>DebridUI can't reach the network. Previously-visited pages and cached posters may still load — try going back.</p>
    <button onclick="location.reload()">Retry</button>
</div>
`;

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        await cache.addAll(APP_SHELL);
    })());
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        const keep = new Set([APP_SHELL_CACHE, STATIC_CACHE, IMAGE_CACHE, METADATA_CACHE]);
        await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

async function putWithCap(cache, request, response, maxEntries) {
    try {
        await cache.put(request, response);
        if (!maxEntries) return;
        const keys = await cache.keys();
        if (keys.length <= maxEntries) return;
        const excess = keys.length - maxEntries;
        for (let i = 0; i < excess; i++) {
            await cache.delete(keys[i]);
        }
    } catch {
        /* quota exceeded or cache unavailable — ignore */
    }
}

function isSameOrigin(url) {
    return url.origin === self.location.origin;
}

function shouldBypass(url) {
    // Never cache API, auth, or other dynamic same-origin endpoints.
    if (isSameOrigin(url)) {
        const p = url.pathname;
        return p.startsWith("/api/") || p.startsWith("/_next/image") || p === "/share";
    }
    return false;
}

// Network-first for navigation; on failure, try last-seen page, then /dashboard,
// then a synthetic offline page.
async function handleNavigation(request) {
    const cache = await caches.open(APP_SHELL_CACHE);
    try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
        return fresh;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        const shell = await cache.match("/dashboard");
        if (shell) return shell;
        return new Response(OFFLINE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const networkPromise = fetch(request)
        .then((res) => {
            if (res && (res.ok || res.type === "opaque")) {
                putWithCap(cache, request, res.clone(), maxEntries).catch(() => {});
            }
            return res;
        })
        .catch(() => null);
    return cached ?? (await networkPromise) ?? Response.error();
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res && (res.ok || res.type === "opaque")) {
        cache.put(request, res.clone()).catch(() => {});
    }
    return res;
}

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (shouldBypass(url)) return;

    if (request.mode === "navigate") {
        event.respondWith(handleNavigation(request));
        return;
    }

    if (isSameOrigin(url) && url.pathname.startsWith("/_next/static/")) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    if (isSameOrigin(url) && /\.(svg|png|jpg|jpeg|webp|woff2?|ico)$/.test(url.pathname)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    if (IMAGE_HOSTS.has(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, 400));
        return;
    }

    if (METADATA_HOSTS.has(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request, METADATA_CACHE, 200));
        return;
    }
});
