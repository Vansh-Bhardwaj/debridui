---
name: debridui-torbox
description: TorBox integration in DebridUI. Covers where the client lives, the API endpoints used, and how to gate TorBox-only features so Real-Debrid, AllDebrid and Premiumize keep working. Use for TorBox dashboard, usenet, transcode or playback-mode work.
---

# TorBox in DebridUI

## Code map
- **Client:** `lib/clients/torbox.ts`. Base URL `https://api.torbox.app/v1/api`, called through the CORS proxy. All providers extend `BaseClient` (`lib/clients/base.ts`), and `getClientInstance` in `lib/clients/index.ts` creates them.
- **Endpoints used today:**
  - `user/me`
  - `torrents/{mylist,requestdl,checkcached,controltorrent,createtorrent}`
  - `webdl/{createwebdownload,mylist,controlwebdownload,requestdl}`
  - `stream/createstream`, which returns HLS with codec info, audio tracks and a resolution ladder
  - `search-api.torbox.app/torrents/search/{q}`
- **Before adding fields or endpoints**, check the official API docs (`https://api.torbox.app/docs`) for exact shapes. `TorBoxUser` (around `torbox.ts:58`) is incomplete. Don't guess field names; if the docs can't be reached, say so in your report.
- **Playback:**
  - `lib/stores/streaming.ts` (ranking, `rankAsConverted`)
  - `lib/streaming/stream-info.ts`
  - `lib/utils/codec-support.ts` (`decideStream`, `playbackEngine`)
  - `components/preview/renderers/{native,legacy}-video-preview.tsx`
  - `docs/ios-playback.md`

## Gating rules
- TorBox-only features (account dashboard, usenet, plan-aware transcode, download progress in the source picker) are shown only when the **active** debrid account is `type === "torbox"`. They are hidden for others, never shown broken.
- Shared features (library, links, sources, playback) must keep working for Real-Debrid, AllDebrid and Premiumize. When you change a `BaseClient` method, update every client or give it a safe default in the base.
- Transcode capability comes from the account's plan or the API, not from the account type alone (today `auth-provider.tsx:179` assumes it).
- Respect the client's rate limiter. Cache account and stat calls with React Query (around 60s), and don't poll faster than every 10s.

## Playback modes (Phase 3)
- `native` (strict): the original file only. Never switch to transcode automatically; the player offers a manual "Try transcoded" button.
- `auto` (default): native, falling back to transcode.
- `transcode`: always use HLS from TorBox or the streaming server.
- All three player paths must honour the mode: iOS native, desktop/Android legacy, and TV. Source ranking must honour it too.
- Once playback has started, never switch to a different source automatically (Nuvio "locked stream" policy). Only recover on the same file.
