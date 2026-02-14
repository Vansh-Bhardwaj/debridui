# DebridUI — Copilot Instructions

## Architecture

Next.js 16 on **Cloudflare Workers** via `@opennextjs/cloudflare`. React 19, Tailwind CSS v4, shadcn/ui. State: **Zustand** stores (persisted) + **TanStack React Query** with IndexedDB persistence. DB: **Drizzle ORM** → Postgres.js → Neon PostgreSQL (via Hyperdrive in prod). Auth: **Neon Auth** (cookie-based, Google OAuth).

Key data flow: User → `useAuthGuaranteed()` → `getClientInstance(user)` → debrid API calls. The `AuthProvider` (`components/auth/auth-provider.tsx`) guarantees non-null `currentAccount`, `currentUser`, and `client` in private routes.

## Debrid Client Pattern

4 providers share `BaseClient` (`lib/clients/base.ts`): RealDebrid, TorBox, AllDebrid, Premiumize. Each has a built-in sliding-window `RateLimiter` (default 250 req/60s). Use `getClientInstance(user)` from `lib/clients/index.ts` — never instantiate directly. All provider-specific logic lives in `lib/clients/<provider>.ts`.

Abstract methods every provider must implement: `addMagnetLinks`, `uploadTorrentFiles`, `findTorrents`, `getDownloadLink`, `getStreamingLinks`, `addWebDownloads`, `getWebDownloadList`, `deleteWebDownload`. The base class handles HTTP→magnet URI split and `.torrent` file downloads automatically in `addTorrent()`.

## Streaming Pipeline

Stremio addon protocol (`lib/addons/`): `AddonClient` fetches streams/subtitles/catalogs → `parseStreams()` normalizes raw `AddonStream` to `AddonSource` (detecting resolution, quality tier, cache status, torrent hash, file size from title/description regexes) → `selectBestSource()` ranks by scoring function (resolution ×10, quality ×5, cached −50, language −20, preferred addon −15, size tie-breaker).

The `useStreamingStore` (`lib/stores/streaming.ts`) orchestrates full play flow:
1. Classify addons by manifest capabilities (`addonSupportsStreams()`, `addonSupportsSubtitles()`)
2. Parallel fetch streams + subtitles — stream-only addons skip subtitle queries and vice versa
3. Select best source using user's quality profile from settings
4. Show toast with metadata → auto-play or prompt → dispatch to browser preview (`usePreviewStore`) or external player (`openInPlayer()`)
5. Episode context tracking for show navigation + `preloadNextEpisode()` in background

## Store Conventions

Zustand stores in `lib/stores/`. Five stores:
- `useSettingsStore` — persisted to localStorage (`debridui-settings`), deep-merge on rehydration fills new keys with defaults. Has typed `get(key)` / `set(key, value)` API
- `useStreamingStore` — non-persisted; play flow, episode context, preloading, request cancellation, device sync interception
- `useVLCStore` — non-persisted; adaptive polling (1s playing/3s paused/5s idle + exponential backoff), bridge detection, full remote control
- `usePreviewStore` — two modes: "gallery" (file tree navigation) and "single" (direct URL playback with subtitles/progress)
- `useSelectionStore` — file/node multi-selection with metadata caching, optimized re-renders via `subscribeWithSelector`
- `useDeviceSyncStore` — cross-device playback control: WebSocket connection, device registry, command dispatch, now-playing reporting, playback queue

Access store state outside React: `useSettingsStore.getState().get("mediaPlayer")`.

## Hook Patterns

- `useAuthGuaranteed()` — use in all private route components. Returns typed `client`, `currentAccount`, `currentUser`. Throws if used outside `AuthProvider`
- `useToastMutation()` (`lib/utils/mutation-factory.ts`) — wraps `useMutation` with automatic loading/success/error toasts. All messages optional. Pattern:
  ```ts
  useToastMutation(
    (vars) => apiCall(vars),
    { loading: "Saving...", success: "Saved", error: "Failed" },
    { onSuccess: () => queryClient.invalidateQueries(...) }
  )
  ```
- `useProgress(key)` — dual-layer progress tracking. localStorage on every update (instant), server sync every 60s + on pause/unmount. Returns `{ initialProgress, updateProgress, forceSync, markCompleted }`
- `useContinueWatching()` — aggregates progress from localStorage + server, merges by recency, filters to 1%–95%
- Trakt hooks (`hooks/use-trakt.ts`) use `createTraktHook()` factory for DRY generation. Follow the same pattern when adding new Trakt endpoints:
  ```ts
  export const useNewTraktHook = createTraktHook(
    ["keyParts"], (args) => traktClient.method(args), CACHE_DURATION.STANDARD
  );
  ```
- Addon hooks (`hooks/use-addons.ts`) — all mutations use optimistic updates with `onMutate/onError/onSettled` pattern. `manifestQueryOptions()` shared factory ensures 24hr cached manifests
- `useFileExplorer()` — paginated torrent listing with adaptive refetch (5s active/30s idle)
- `useSearchLogic()` — 3 parallel search sources: Trakt (movies/shows), debrid files, TorBox source search
- `useFileLinkActions()` / `useFileMutationActions()` — bulk file operations (copy/download/playlist/delete/retry)

## Server Actions & Database

Server actions in `lib/actions/` follow this pattern:
1. `auth.getSession()` → redirect to `/login` if no session
2. Zod validation on inputs
3. Single optimized query (upserts with `onConflictDoUpdate`, batched `CASE WHEN` for reordering, subquery for computed values)
4. Return typed results

DB connection (`lib/db/drizzle.ts`) resolves in priority: Hyperdrive binding → `process.env.DATABASE_URL` → `ctx.env.DATABASE_URL`. Critical: `prepare: false` required for Hyperdrive (no prepared statements). Per-request caching in Workers via `WeakMap`, singleton in dev.

Schema (`lib/db/schema.ts`): `userAccounts`, `addons`, `userSettings` (JSONB), `userProgress`. All keyed by `userId` with cascade delete. UUIDs via `uuidv7()`.

## VLC Integration

Two-layer integration:
1. **`VLCBridgeClient`** (`lib/vlc-bridge.ts`) — communicates with browser extension via CustomEvent bridge (content script) or `chrome.runtime.sendMessage` (direct). Full API: play, pause, seek, volume, tracks, subtitles, playlist
2. **`useVLCStore`** — polls VLC status adaptively, parses audio/subtitle tracks with codec names, auto-selects preferred subtitle language on new media
3. **`vlc-progress.ts`** — bridges VLC playback with progress tracking + Trakt scrobble (start/pause/stop on state transitions)
4. **`VLCMiniPlayer`** component — floating player with seek, ±10s, volume, track switchers, episode navigation, auto-next on natural completion

Subtitle delivery to VLC: URLs proxied through `/api/subtitles/vlc/{label}?url=...` so VLC can detect language from filename.

## External Player Support

`openInPlayer()` (`lib/utils/media-player.ts`) generates protocol handler URLs for 9 players. Platform detection via `navigator.userAgentData` (Client Hints) → UA string fallback. VLC on desktop tries bridge extension first (full subtitle + progress support), falls back to protocol URL. Android uses `intent://` URIs; iOS uses `vlc-x-callback://`.

## Device Sync (Cross-Device Playback)

Spotify Connect-like feature for controlling playback across devices. Three sync layers:
1. **BroadcastChannel** — same-browser tabs (instant, zero server cost)
2. **WebSocket via Durable Object** — cross-device (<100ms, CF free tier)
3. **(Future) Local network via Tauri mDNS**

Architecture: Separate Cloudflare Worker (`device-sync-worker/`) with Durable Objects + WebSocket Hibernation. Auth via HMAC-SHA256 tokens (24hr validity) generated by `/api/remote/token`. The `useDeviceSyncStore` manages connection, device registry, command dispatch (browser video + VLC), now-playing reporting, and playback queue. Components in `components/device-sync/` provide device picker (header dropdown), remote banner (bottom bar controls), pair dialog, queue UI, and remote file browser. Public `/pair` page allows unauthenticated remote control via shareable link.

## Preview System

Plugin registry (`lib/preview/registry.ts`): 4 renderers (video, image, text, YouTube). Each registered with `registerPreviewRenderer()` mapping `FileType` → React component. Components receive `{ file, downloadUrl, streamingLinks, subtitles, progressKey, onNext, onPrev }`.

Video playback: `selectBestStreamingUrl()` (`lib/utils/codec-support.ts`) auto-selects HLS for iOS/Safari, liveMP4 for MKV transcoding, direct for compatible files. Codec detection via `canPlayType()` for H.264/HEVC/VP9/AV1/AC3/DTS/etc.

## UI / Design System

**Read `docs/ui-minimal.md` before any UI work.** Key rules:
- Always use shadcn/ui components from `components/ui/` — never create custom buttons/inputs/dialogs
- Headings: `font-light`. Labels: `text-xs tracking-widest uppercase text-muted-foreground`
- Borders: `border-border/50`. Backgrounds: `bg-muted/30`. Radius: `rounded-sm`
- Metadata: inline text with `·` separators, not badges. Icons: `size-4` default, `size-5` headers
- Standard button sizes only: `sm` (h-8), `default` (h-9), `lg` (h-10)

## Code Conventions

- **Bun** as package manager — `bun install`, `bun run dev`, `bun run lint`
- Validate with `bun run lint` (runs `tsc --noEmit && eslint .`) before committing
- Unused vars: prefix with `_`. No `eslint-disable` unless absolutely necessary
- Zod v4 for validation (`lib/schemas.ts`). Types derived via `z.infer<>` in `lib/types.ts`
- Path alias: `@/` maps to project root. Always use `@/lib/...`, `@/components/...`, `@/hooks/...`
- No over-engineering: simplest solution that works. Minimal code, fewest lines necessary
- CORS proxy fallback in `AddonClient`: tries direct fetch first, falls back to `/api/addon/proxy`
- Chunked parallel execution: `chunkedPromise()` from `lib/utils/` for batched API calls (configurable chunk size + inter-chunk delay)
- File type detection: `getFileType(filename)` — maps extensions via `EXTENSION_TO_FILE_TYPE` in `lib/constants.ts`
- CDN image proxy: `cdnUrl(url, { w, h })` via wsrv.nl with WebP conversion
- Subtitle language matching: `isSubtitleLanguage(sub, "english")` supports 30+ languages with ISO 639-1/2/3 codes + display name aliases

## Key Directories

| Path | Purpose |
|---|---|
| `lib/clients/` | Debrid provider implementations (RealDebrid, TorBox, AllDebrid, Premiumize) |
| `lib/addons/` | Stremio addon client (`client.ts`), stream parser (`parser.ts`), types + capability helpers (`types.ts`) |
| `lib/stores/` | Zustand stores: settings, streaming, vlc, preview, selection, device-sync |
| `lib/streaming/` | Source selection/ranking logic (`source-selector.ts`) |
| `lib/preview/` | File preview renderer registry + registration |
| `lib/utils/` | Shared utilities: file ops, media-player launchers, codec detection, subtitle matching, cache keys, mutation factory, error handling |
| `lib/actions/` | Server actions: addons, user-accounts, settings, auth |
| `lib/db/` | Drizzle schema, connection factory, auth schema |
| `lib/device-sync/` | Device sync client, protocol types, BroadcastChannel wrapper |
| `hooks/` | React hooks: progress, file-explorer, search, trakt, trakt-scrobble, addons, file-actions, user-accounts, user-settings |
| `components/ui/` | shadcn/ui primitives — don't modify |
| `components/explorer/` | File explorer: tree view, list view, search, sort, context menu, batch operations |
| `components/mdb/` | Media database: cards, details, hero carousel, search, sources, season/episode browser, continue watching |
| `components/preview/` | Preview dialog, renderers (video, image, text, YouTube), codec warnings |
| `components/sidebar/` | App sidebar, account switcher, nav |
| `components/web-downloads/` | Web download manager: add links, download list, bulk actions |
| `components/device-sync/` | Cross-device playback: device picker, remote banner, pair dialog, browse handler, queue |
| `app/(auth)/(app)/` | Authenticated routes: dashboard, files, search, discover, movies/[slug], shows/[slug], people/[slug], watchlist, accounts, links, addons, settings, status, help |
| `app/(public)/` | Public routes: landing, login, signup, forgot-password, reset-password, pair, status |
| `app/api/` | API routes: addon proxy, auth, health, progress, remote (device sync tokens), subtitles (VLC proxy), trakt OAuth |

## Adding a New Debrid Provider

1. Create `lib/clients/<name>.ts` extending `BaseClient`
2. Implement all abstract methods (see `lib/clients/base.ts` for signatures)
3. Add to `AccountType` enum in `lib/schemas.ts`
4. Register in `lib/clients/index.ts` switch statement
5. Add icon/label in `lib/constants.ts` (`ACCOUNT_TYPE_LABELS`, `ACCOUNT_TYPE_ICONS`)

## Adding a New Stremio Addon Feature

Addon capabilities are declared in manifests (`resources` array). Use `addonSupportsStreams()`, `addonSupportsSubtitles()`, `addonSupportsCatalogs()` from `lib/addons/types.ts` to check capabilities before querying. The streaming store classifies addons before fetching — stream-only addons aren't queried for subtitles and vice versa.

## Adding a New Preview Renderer

1. Create component in `components/preview/renderers/` implementing `PreviewRendererComponent` interface
2. Register in `lib/preview/register-renderers.ts` with `registerPreviewRenderer({ id, fileTypes, component, canPreview })`
3. Add file extensions to `EXTENSION_TO_FILE_TYPE` in `lib/constants.ts` if needed
