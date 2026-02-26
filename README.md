<div align="center">

# DebridUI

**A modern debrid client with built-in playback, cross-device sync, and subtitle support.**

Installable as a PWA. Edge-deployed on Cloudflare Workers for fast, global access.

<br />

<a href="https://debrid.indevs.in"><img src="https://img.shields.io/website?url=https%3A%2F%2Fdebrid.indevs.in&label=Live%20Demo&style=for-the-badge&color=brightgreen" alt="Live Demo" /></a>
&nbsp;
<a href="https://github.com/Vansh-Bhardwaj/debridui"><img src="https://img.shields.io/github/stars/Vansh-Bhardwaj/debridui?style=for-the-badge&color=yellow&logo=github" alt="Stars" /></a>
&nbsp;
<a href="./LICENSE"><img src="https://img.shields.io/github/license/Vansh-Bhardwaj/debridui?style=for-the-badge&color=blue" alt="License" /></a>

<br />

<a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js" /></a>
<a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
<a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" /></a>
<a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" /></a>
<a href="https://neon.tech"><img src="https://img.shields.io/badge/Neon_PostgreSQL-00E599?style=flat-square&logo=postgresql&logoColor=white" alt="Neon" /></a>
<a href="https://orm.drizzle.team"><img src="https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black" alt="Drizzle" /></a>

</div>

<br />

> [!IMPORTANT]
> This project does not provide, host, or stream any content. DebridUI is a client interface that connects to third-party debrid service APIs to display authorized users' private files and content. [Read full disclaimer →](DISCLAIMER.md)

---

## 🆕 What's New (February 2026)

**Latest Update: February 26, 2026**

- ⚡ **Node.js v25.7.0** — Latest runtime with performance improvements
- 🎨 **Tailwind CSS 4.2.1** — Faster builds and improved performance
- 📦 **Updated dependencies** — React Dropzone v15, latest Wrangler, and more
- 🚀 **ES2022 target** — Better code optimization and smaller bundles

---

## 🎬 About

DebridUI is an open-source web client for managing debrid service files and streaming media. This fork builds on the excellent foundation by [@viperadnan](https://github.com/viperadnan-git/debridui) — whose continuous work on the original project made this possible — and adds a set of features focused on playback, performance, and edge deployment.

| Instance | Stack |
|---|---|
| 🌐 **[debrid.indevs.in](https://debrid.indevs.in)** | This fork — Cloudflare Workers |
| 🌐 [debridui.viperadnan.com](https://debridui.viperadnan.com) | Original by viperadnan |

---

## ✨ Highlights

This fork extends the original with several additions:

<table>
<tr>
<td width="50%" valign="top">

### 🎥 Streaming & Playback
- **Built-in video player** with codec detection and iOS fixes
- **Continue watching** — resume where you left off, on any device
- **Device Sync** — Spotify Connect-like cross-device playback control
- **Subtitle integration** from Stremio addons via proxy
- **External players** — VLC (Android/iOS/desktop), IINA, MPV, Kodi & more
- **VLC browser extension** — send streams to VLC Desktop from the browser
- **Smart addon filtering** — stream & subtitle addons queried separately
- **Cancel button** on the streaming lookup toast

</td>
<td width="50%" valign="top">

### ⚡ Performance & Infrastructure
- **PWA installable** — works offline, add to home screen
- **Cloudflare Workers** — edge-deployed globally
- **Hyperdrive** — connection pooling & query caching for PostgreSQL
- **Adaptive polling** — 5–30s dynamic intervals, pauses in background
- **Optimized DB queries** — upserts, batched reordering, ON CONFLICT
- **Health monitoring** — public `/status` page with live checks
- **Keyboard shortcuts** — press `?` for the full list

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 📂 File Management
- **Multi-account** — Real-Debrid, TorBox, AllDebrid, Premiumize
- **Advanced explorer** — tree view, search, sort, batch operations
- **Drag & drop** — upload torrents, magnets, and files
- **Web downloads** — direct URL downloads with progress

</td>
<td width="50%" valign="top">

### 🔍 Media Discovery
- **Trakt.tv** — trending, popular, and recommended titles
- **Trakt watchlist & calendar** — synced movies/shows with upcoming releases
- **Stremio addon search** across all configured sources
- **YouTube trailers** — embedded previews on media pages
- **Detailed pages** — cast, ratings, season & episode browser

</td>
</tr>
</table>

<details>
<summary><strong>Comparison with upstream</strong></summary>

<br />

> Both projects are actively developed. The upstream focuses on a clean, universal deployment; this fork leans into Cloudflare edge deployment and adds playback features.

| Area | This Fork | Upstream |
|---|---|---|
| Deployment | Cloudflare Workers + Hyperdrive | Vercel / standalone |
| Database driver | `postgres` (Postgres.js) via TCP proxy | `@neondatabase/serverless` |
| Built-in video player | ✅ Codec detection, iOS fixes | External player links |
| Continue watching | ✅ Cross-device progress | — |
| Device Sync | ✅ Spotify Connect-like remote control | — |
| PWA installable | ✅ Offline support, home screen | — |
| Trakt watchlist/calendar | ✅ Synced with tabs | — |
| Keyboard shortcuts | ✅ Press `?` for full list | — |
| VLC browser extension | ✅ Send streams to VLC Desktop | — |
| Subtitle support | ✅ Proxy-based from addons | — |
| Addon filtering | ✅ Manifest-based capability check | All addons queried |
| VLC iOS | ✅ Platform-specific URLs | Single scheme |
| Streaming cancel | ✅ Cancel button on toast | — |
| Addon catalog browser | — | ✅ Browse community addons |
| CDN image proxy | — | ✅ wsrv.nl optimization |
| Adaptive polling | ✅ 5–30s dynamic | Fixed interval |
| Health / Status | ✅ Public status page | — |

</details>

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.3+ (or Node.js 22+ LTS / 25+ Current)
- [Neon](https://neon.tech) PostgreSQL database
- [Cloudflare](https://cloudflare.com) account (for production)
- A debrid account — Real-Debrid, TorBox, AllDebrid, or Premiumize

### Quick Start

```bash
git clone https://github.com/Vansh-Bhardwaj/debridui
cd debridui
bun install
cp .env.example .env.local   # then edit with your values
bunx drizzle-kit push
bun run dev
```

Open **[http://localhost:3000](http://localhost:3000)** and you're in.

<details>
<summary><strong>Environment Variables</strong></summary>

<br />

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Dev only | PostgreSQL connection string (prod uses Hyperdrive) |
| `NEON_AUTH_COOKIE_SECRET` | ✅ | Cookie encryption — `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public deployment URL |
| `NEXT_PUBLIC_CORS_PROXY_URL` | ✅ | CORS proxy for addon API requests |
| `NEXT_PUBLIC_TRAKT_CLIENT_ID` | ✅ | Trakt.tv API client ID |
| `TRAKT_CLIENT_SECRET` | ✅ | Trakt.tv API client secret (set via `wrangler secret put`) |
| `NEXT_PUBLIC_NEON_AUTH_URL` | ✅ | Neon Auth endpoint |
| `NEON_AUTH_BASE_URL` | ✅ | Neon Auth base URL (server-side) |
| `NEXT_PUBLIC_DISCORD_URL` | — | Discord invite link (shown in UI) |
| `NEXT_PUBLIC_DISABLE_EMAIL_SIGNUP` | — | `"true"` to disable email signup |
| `NEXT_PUBLIC_DEVICE_SYNC_URL` | — | Device Sync Worker URL for cross-device playback |
| `SYNC_TOKEN_SECRET` | — | HMAC secret shared between main app and sync worker |

See [`.env.example`](.env.example) for a full template.

</details>

<details>
<summary><strong>Deploy to Cloudflare Workers</strong></summary>

<br />

This fork uses [@opennextjs/cloudflare](https://opennext.js.org/cloudflare) for Cloudflare Workers deployment:

```bash
bun run build
bunx wrangler deploy
```

**Full setup:**

1. Create a [Neon](https://neon.tech) database
2. Create a [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) config pointing to it
3. Update `wrangler.jsonc` with your Hyperdrive ID and env vars
4. Set secrets: `bunx wrangler secret put NEON_AUTH_COOKIE_SECRET`
5. Deploy the CORS proxy worker (see below)
6. Deploy: `bunx wrangler deploy`

> **Alternative:** The app also works as a standard Next.js deployment (Vercel, self-hosted, etc.) — just set `DATABASE_URL` in your environment.

</details>

<details>
<summary><strong>CORS Proxy Setup</strong></summary>

<br />

Stremio addons require a CORS proxy. Deploy `proxy.worker.js` to Cloudflare Workers:

1. Create a Worker on [Cloudflare Workers](https://workers.cloudflare.com)
2. Paste the contents of `proxy.worker.js`
3. Update `ALLOWED_ORIGINS` with your deployment domain(s)
4. Deploy and use the worker URL as `NEXT_PUBLIC_CORS_PROXY_URL`

</details>

<details>
<summary><strong>Device Sync Setup (Optional)</strong></summary>

<br />

Cross-device playback control (Spotify Connect-like). Requires a separate Cloudflare Worker:

```bash
cd device-sync-worker
npm install
npx wrangler deploy
```

1. Generate a shared secret: `openssl rand -base64 32`
2. Set the secret on both workers:
   - `npx wrangler secret put SYNC_TOKEN_SECRET` (in `device-sync-worker/`)
   - `bunx wrangler secret put SYNC_TOKEN_SECRET` (in project root)
3. Set `NEXT_PUBLIC_DEVICE_SYNC_URL` in `wrangler.jsonc` to your sync worker URL
4. Enable Device Sync per-user in Settings → Integrations

See [docs/DEVICE-SYNC.md](docs/DEVICE-SYNC.md) for full architecture details.

</details>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
│  React 19 · Zustand · React Query (IDB cache)   │
└────────┬───────────────────────────┬────────────┘
         │                           │
         │                ┌──────────▼──────────┐
         │                │  Device Sync Worker │
         │                │  Durable Objects +  │
         │                │  WebSocket (WS)     │
         │                └─────────────────────┘
         │
         ┌───────────▼───────────┐
         │   Cloudflare Workers  │
         │   Next.js SSR + API   │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │     Hyperdrive        │
         │  TCP proxy + pooling  │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Neon PostgreSQL     │
         │     (serverless)      │
         └───────────────────────┘
```

| Layer | Stack |
|---|---|
| **Frontend** | React 19 + Tailwind CSS v4 + shadcn/ui |
| **State** | Zustand stores + React Query with IndexedDB persistence |
| **Database** | Drizzle ORM → Postgres.js (`prepare: false`) → Hyperdrive |
| **Auth** | Neon Auth (cookie-based, Google OAuth) |
| **Addons** | Stremio-compatible protocol with manifest-based filtering |
| **Device Sync** | Cloudflare Durable Objects + WebSocket Hibernation |

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

---

## ⚠️ Disclaimer

This project is a client interface only and does not host, store, or distribute any content. Users are solely responsible for ensuring their use complies with all applicable laws, copyright regulations, and third-party service terms. [Read full disclaimer →](DISCLAIMER.md)

---

<div align="center">

**GPL-3.0-or-later** — see [LICENSE](LICENSE) for details.

Built with ❤️ on the shoulders of [viperadnan/debridui](https://github.com/viperadnan-git/debridui)

</div>
