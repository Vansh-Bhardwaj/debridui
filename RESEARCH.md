# DebridUI Competitive Landscape & Improvement Research

> Research date: Feb 10, 2026. Temporary reference document.
> Cross-referenced against existing feature inventory to exclude what DebridUI already has.

---

## Projects Researched

| Project | Stars | Stack | Focus |
|---|---|---|---|
| **Debrid Media Manager** (DMM) | 1.2k | Next.js/TS | Library curation, sharing, WebDAV |
| **Riven** | 731 | Python | Plex/Jellyfin/Emby automation with debrid |
| **MediaFusion** | 763 | Python/FastAPI | Stremio+Kodi addon with scraping pipeline |
| **Debrify** | 184 | Flutter/Dart | Cross-platform native app with built-in player |
| **rdebrid-ui** | 76 | Vite/TS | Lightweight Real-Debrid SPA |
| **RDM** | 88 | SvelteKit | Real-Debrid manager with scraper |
| **mediaflow-proxy** | — | Python | Streaming proxy with DRM decryption |
| **DebriDav** | — | Kotlin | WebDAV bridge for debrid → media servers |

### What DebridUI Already Has (not suggested below)
- Built-in browser video player (Preview system: HLS/DASH/liveMP4, codec detection, subtitle tracks, auto-resume, transcoded fallback)
- Magnet/torrent add (textarea + file drag-and-drop, up to 100 files)
- Debrid account dashboard (account switcher, user info caching, onboarding)
- Batch operations (multi-select, actions drawer: copy/download/delete/retry/playlist)
- Source quality scoring (resolution + quality weights, cached bonus, 5 profiles + custom)
- Torrent health/cache badges (seeders, cache status parsed from addon streams)
- Stremio-style board home (Continue Watching + 5 Trakt carousels + addon catalogs)
- Progressive inline stream loading (parallel addon fetch, auto-play cached)
- Toast-based streaming status (loading → source found → Play/Cancel actions)
- 9 external players (VLC, IINA, Infuse, MPV, PotPlayer, Kodi, MX Player, MX Player Pro, Browser)
- Keyboard shortcuts (⌘K search, arrow nav in preview, Enter submit, Escape close)
- Subtitle system (30+ languages, SRT→WebVTT proxy, language filtering)
- Trakt scrobble (OAuth, auto-refresh, start/pause/stop events, VLC progress sync)

---

## Feature Ideas (genuinely missing)

### P0 — High Impact, Low Effort

1. **PWA / Installable Web App**
   DMM is a PWA with offline support. Add `manifest.json` + service worker for "Add to Home Screen" on mobile and cached app shell. No backend changes needed — just static assets.

2. **Trakt Watchlist & Calendar View**
   Trakt API supports watchlist and calendar endpoints. Surface a dedicated "/watchlist" page showing the user's Trakt watchlist with one-click search for sources. Add an episode calendar showing upcoming releases from tracked shows with air dates.

3. **Keyboard Shortcuts Help Panel**
   A `?` overlay showing all keyboard shortcuts. Small UX polish — many power users expect this (GitHub, Gmail, VS Code all have it).

### P1 — High Impact, Medium Effort

4. **Library Sharing & Mirroring**
   DMM's killer feature. Export torrents as a compressed hash list in a shareable URL. Others can preview the library and one-click mirror content to their debrid accounts. No server storage needed — data is encoded in the URL.

5. **Library Deduplication & Quality Grouping**
   Group torrents by media title (fuzzy match), flag duplicate files with lower quality scores, offer one-click cleanup (keep best, delete rest). DMM's quality score grouping.

6. **Torrent Pre-Cache Check**
   Before adding a magnet via the Add Content form, check if the hash is already cached on the user's debrid service. Show a green "Instant" badge or red "Uncached" warning. rdebrid-ui, DMM, Debrify all do this inline.

7. **Debrid-Link Client (5th service)**
   Add to `lib/clients/`. The abstract `BaseClient` + rate limiter makes this low risk. Serves the French market and matches parity with MediaFusion/Jackettio. API docs: https://debrid-link.com/api

### P2 — Medium Impact, Medium Effort

8. **RSS Feed Auto-Download**
   Let users add RSS feeds (or Trakt calendar filters) that auto-add new episodes to their debrid account. RDRSS is a standalone project for this. Could run as a Cloudflare Cron Trigger on the existing Worker.

9. **Custom Subtitle Upload**
   Alongside auto-fetched subtitles, let users upload .srt/.ass files for the current playback. Store temporarily and inject into the preview player's track list.

10. **Collection / Playlist System**
    Named server-side collections ("Marvel Order", "Weekend Movies"). Stored in `user_settings` JSONB. Users can reorder and share via URL. Richer than Continue Watching.

11. **TV / Lean-Back Mode**
    Debrify's Android TV mode. Full-screen interface with large artwork, minimal chrome, arrow-key/remote navigation, auto-next episode. Good for HTPC/Chromecast setups.

12. **IPTV / M3U Playlist Support**
    Import M3U playlists for live TV channels. Debrify and MediaFusion both support this. Could reuse the existing browser video player.

---

## Technical Improvements (genuinely missing)

| # | Improvement | Details | Effort |
|---|---|---|---|
| T1 | **Virtual scrolling** | `@tanstack/react-virtual` for 1000+ files in explorer. Current pagination (50/page) works but virtual scrolling enables infinite scroll. | Low |
| T2 | **Service Worker caching** | Cache TMDB metadata, poster images, Trakt data offline. Goes hand-in-hand with PWA (#1). | Low |
| T3 | **SSE for download progress** | Replace 5s/30s adaptive polling with Server-Sent Events for real-time download speed/progress. Reduces API calls, improves responsiveness. | Medium |
| T4 | **Edge TMDB caching** | Cloudflare KV or D1 to cache TMDB responses at edge. Reduces TMDB API rate limit pressure and latency. | Medium |
| T5 | **Streaming proxy Worker** | Dedicated CF Worker that proxies debrid streaming links with CORS + range requests. mediaflow-proxy pattern. Improves in-browser playback reliability. | Medium |
| T6 | **PikPak client** | Free-tier debrid alternative. Debrify & MediaFusion support it. Would differentiate DebridUI for budget users. | Medium |

---

## Integrations Worth Adding

| Integration | Value | Effort |
|---|---|---|
| **Zilean DMM** | Search cached debrid content — instant availability before adding | Low |
| **Simkl** | Alternative to Trakt for anime tracking users | Low |
| **OpenSubtitles REST API v2** | Better subtitle search by IMDB ID + file hash (vs current addon-based) | Low |
| **Prowlarr/Jackett** | Direct indexer access for private tracker support | Medium |
| **Overseerr/Jellyseerr** | Request management for shared/family instances | Medium |
| **StremThru** | Unified debrid proxy — one integration covers all services automatically | Low-Medium |
| **Plex/Jellyfin webhooks** | Receive scrobble events from media servers to sync watch state | Medium |

---

## Priority Matrix

| Priority | Feature | Why |
|---|---|---|
| **P0** | PWA support (#1) | 2-3 hours, huge mobile UX win, no backend |
| **P0** | Trakt Watchlist + Calendar (#2) | Leverages existing Trakt integration, high discovery value |
| **P0** | Shortcuts panel (#3) | 30 min, pure UX polish |
| **P1** | Library Sharing (#4) | DMM's biggest community differentiator |
| **P1** | Pre-Cache Check (#6) | Table-stakes for debrid UIs, every competitor has it |
| **P1** | Debrid-Link client (#7) | Architecture already supports it, market expansion |
| **P1** | Virtual scrolling (T1) | Prevents scale issues, low effort |
| **P2** | Library Dedup (#5) | Power user value, medium effort |
| **P2** | RSS Auto-Download (#8) | Power user / set-and-forget feature |
| **P2** | Zilean integration | Instant cached content discovery |
| **P2** | SSE downloads (T3) | Replace polling, better UX |
| **P3** | Collections (#10) | Nice-to-have organization feature |
| **P3** | TV/Lean-back (#11) | Niche but impressive differentiator |
| **P3** | IPTV (#12) | Edge case for live TV users |
