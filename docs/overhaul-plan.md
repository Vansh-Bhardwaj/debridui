# DebridUI Overhaul Plan

Status: **approved 2026-11-13**, with the decisions in §4. Built by GPT-6.1 Sol (medium) subagents; Claude reviews and commits.

Goal: a plug-and-play, Netflix-style experience built around TorBox. It should have family profiles, a separate interface for each kind of device, a full Big Picture/TV mode, clear playback options and optional streaming-server support. The current colours and flat look stay.

---

## 1. Where we are today

| Area | Current state | Main gap |
|---|---|---|
| Identity | One Better Auth user. More than 40 places read `session.user.id` directly | No profiles and no shared "who is this" helper |
| Watch data | `user_progress`, `watch_history` and `hidden_continue_watching` are keyed by user | Everyone in the family shares one history |
| Trakt | Tokens live in `user_settings` jsonb, and one client-side `traktClient` singleton serves the whole app | Can only be per-account, not per-person |
| Preferences | The Zustand store `debridui-settings` stays on each device and is never synced | Preferences don't follow a person from one device to another |
| TorBox | Library, cache check, web downloads, HLS transcode and search are used. Account info covers only email, premium status and expiry | No dashboard, limits or usage. Transcode is assumed for every plan. No usenet |
| Playback | `playbackEngine` = auto / original / compatible / device | iOS ignores it, "original" isn't strict, and ranking doesn't take it into account |
| Streaming server | None. The proxy deliberately blocks LAN addresses | Nothing exists yet |
| Devices | `useIsMobile` (only width under 768px), plus a manual `tvMode` switch | Tablets and TVs aren't detected for the interface, the phone layout flashes as desktop first, and every page decides inline with `tvMode ? … : …` |
| Navigation | Desktop sidebar. Phones get the same sidebar as a pull-out sheet, and TV gets a 6-item top bar | No phone tab bar. Half the app can't be reached in Big Picture |
| Settings | One 1,183-line page with every option shown on every device | Needs to be split into sections and filtered by device |
| Home | Hero, continue watching, For You (Trakt only), addon catalogs, Trakt lists | Without Trakt there are no recommendations, no genre rows and no "because you watched" |
| Design docs | `ui.md` says Inter and multiple corner sizes, but the code uses Styrene B and square corners everywhere | The docs no longer match the code. The font is a *trial* build loaded from jsdelivr, which may raise a licensing issue |

---

## 2. Guiding decisions

1. **Detect the device once and share the answer.** A single `useDevice()` returns `phone | tablet | desktop | tv`, based on the user agent, Client Hints, the input type and an optional override. The server sets it through a cookie, so the first screen is already the right layout. Pages read this one value instead of each making their own `tvMode` / `isMobile` checks.
2. **Each device type gets its own frame; pages are shared.** Phone, desktop and TV each get their own frame (navigation, header, player chrome). The content in the middle is shared, with variants only where they're really needed.
3. **Settings are a list of entries, each tagged with the devices it applies to** (`devices: ["desktop","tv"]`). A phone simply never shows an option meant for desktop, and nobody has to remember to hide it page by page.
4. **Shared across the family:** debrid accounts, addons, the TMDB key and device-sync pairing. Sharing these is the whole point of profiles.
   **Separate for each profile:** history, progress, continue watching, hidden items, its own Trakt connection, preferences (language, subtitles, quality, autoplay, playback mode) and its name, avatar and colour. No PINs and no kid profiles.
5. **TorBox gets the most effort.** Real-Debrid, AllDebrid and Premiumize must keep working fully. TorBox-only features (dashboard, usenet, plan-aware transcode, download progress) are gated on the account type and are hidden, not broken, for the others.
6. **Keep the look:** OKLCH neutrals, gold primary, green secondary, square corners, no gradients or heavy shadows. The update tightens the system rather than restyling it.

---

## 3. Phases

Each phase can be shipped by itself and is committed straight to `main`.

### Phase 0 — Foundations (no visible change)
- `getActor()` server helper → `{ userId, profileId }`. It replaces the scattered `auth.getSession()` reads in `lib/actions/*` and `app/api/*`.
- `useDevice()` plus a server-side device cookie. Big Picture will **auto-enable on TVs**. Shrinking a desktop window will **no longer exit** it.
- A settings registry that records each setting's type, default, scope (profile / device / account) and the devices it applies to.
- Update the design-system docs to match the real code (Styrene B or a replacement, square corners, real token values). Add device scale tokens: phone touch targets, TV type scale, TV focus ring.
- Keep the current font (Styrene B). No change.

### Phase 1 — Profiles
- **Database:** add a `profiles` table (`user_id`, name, avatar, colour, `created_at`) and a `profile_settings` table (`profile_id` primary key, jsonb with Trakt tokens and preferences).
- **Columns:** add `profile_id` to `user_progress`, `watch_history`, `hidden_continue_watching` and `watch_events`. Rebuild their unique indexes with **NULLS NOT DISTINCT**, using hand-written SQL, never `drizzle-kit push`.
- **Backfill:** give every existing user a "Default" profile and move their rows and Trakt tokens onto it.
- **Rollout safety:** local dev uses the production database, and the unique-index swap breaks the currently deployed code's `ON CONFLICT` upserts. So the migration is written now but applied only at deploy time, together with the new code. Profile writes are tested beforehand on a Neon branch (`DATABASE_URL` → branch). Login keeps working there because auth goes through the Neon Auth URL, not the database.
- **Active profile:** stored in a signed httpOnly cookie. `getActor()` checks it against the user, using a short in-memory cache so the per-request Cloudflare CPU limits still pass.
- **Screens:**
  - Netflix-style "Who's watching?" screen after sign-in, plus profile management (add, edit, delete). It is skipped when there's only one profile.
  - A profile switcher in the shell of each device type.
- **Switching profile:**
  - Reset `traktClient` and clear React Query (put `profileId` in the query keys).
  - Keep `progress:*` and preference storage separate for each profile.
- **Trakt:** OAuth state carries the profile, so each person links their own Trakt account.

### Phase 2 — A separate interface for each device + settings rework
- **Phone:**
  - A bottom tab bar (Home, Search, My List, Downloads/Files, Profile).
  - No hover-only controls, no keyboard-shortcut hints and no Big Picture toggle.
  - Detail pages and the player menus open as bottom sheets.
- **Tablet:** a phone-style tab bar in portrait, and a sidebar that collapses to icons in landscape.
- **Desktop:** today's sidebar, trimmed down, with keyboard shortcuts and the device picker.
- **TV / Big Picture:**
  - Every route can be reached from the TV top bar or a menu.
  - All pages get `data-tv-focusable` markup, including files, search, links, status and help.
  - On-screen keyboard search and a dedicated TV player overlay.
- **Settings:**
  - Split into sub-pages: Profile, Playback, Streaming, Subtitles, Appearance, Accounts & TorBox, Addons, Devices, Data, About.
  - Each sub-page renders from the registry and shows only what applies to the current device. A search box covers desktop and tablet.
- **Clean-up:** remove the inline `tvMode` checks from pages as each one moves over to the new frames.

### Phase 3 — Getting much more out of TorBox, plus playback modes
- **Account dashboard** (Settings → TorBox) showing everything the API exposes:
  - plan tier, expiry and renewal
  - total downloaded/uploaded
  - active and queued slots against the plan limit
  - cooldown
  - assigned server
  - usenet and web-download usage
  - transcode/stream availability for the plan
  - notifications, referral
- First check the TorBox API docs for the exact `user/me?settings=true` fields and any stats endpoints. Our `TorBoxUser` type is incomplete today.
- **Plan-aware transcode:** read the real capability from the plan instead of assuming it for every TorBox account.
- **Usenet:** add usenet (create, list, request download link) behind the same library interface.
- **TorBox library:** queue status and progress, so a "not cached → downloading 42%" state appears right in the source picker.
- **Playback mode:** one clear setting per profile, with a per-device override, replacing `playbackEngine`:
  - *Native only*: always play the original file. There's no automatic switch to transcoding; the player offers a manual "try transcoded" button instead.
  - *Native, fall back to transcode* (default): what `auto` does today.
  - *Transcode only*: always use the TorBox HLS stream (or the streaming server).
  - All three player paths must honour it: iOS native, desktop/Android, and TV. Source ranking (`rankAsConverted`) must too.
- External players can optionally receive the HLS stream instead of the raw file.

### Phase 4 — A Netflix-style home and plug-and-play onboarding
- **Onboarding:**
  1. Sign up.
  2. Create a profile.
  3. Paste a TorBox key.
  4. The app **automatically installs a recommended addon set already configured for TorBox**, then you're watching. Power users can still manage addons themselves.
- **Home rows, per profile and with no Trakt needed:**
  - Continue Watching, plus Up Next for the following episode
  - Because You Watched X (TMDB recommendations from the profile's history)
  - Top 10 Today (TMDB/Trakt trending)
  - Genre rows chosen from what the profile watches
  - New Episodes of shows you watch
  - Leaving soon / just added to TorBox (your library)
  - Trakt lists when Trakt is linked
- **Detail page:** trailer or backdrop preview, "Play" that chooses the best cached source automatically (sources are still shown on request), season/episode picker, More Like This.
- **My List:** a local, per-profile watchlist that syncs to Trakt when Trakt is linked. Today the watchlist only works with Trakt.
- **Quality-of-life:**
  - skip intro / credits (introdb already exists)
  - autoplay the next episode with a countdown
  - remember audio and subtitle language for each show
  - pre-resolve the next episode's source
  - "Are you still watching?"

### Phase 5 — Streaming server support (Stremio-compatible, Harbor)
[Harbor](https://github.com/Harborofficial/Harbor) is a Tauri desktop Stremio client that bundles `stremio-server` as a sidecar and falls back to its HLS transcoder on decode errors. So "use Harbor's server" is the same integration as "use Stremio's server". Read Harbor's `src-tauri/` for the exact port and endpoints before building.

Connection options:
- **Use the server the user already has:** Stremio desktop runs a streaming server on `:11470` (HTTP) / `:12470` (HTTPS, through a LAN certificate domain). DebridUI connects to it, so the user doesn't have to install another one.
- **LAN:** use the HTTPS endpoint so browsers don't block it as mixed content. CORS must be checked against the server's actual responses.
- **Remote:** a user-provided URL, either a Cloudflare Tunnel or a public HTTPS server. The worker's LAN block stays as it is (it's there for security). A remote server is reached either directly or through a new signed route limited to the user's own server address.

What the server would be used for:
- Transcoding (`/hlsv2/…/master.m3u8?mediaURL=…`) as a second transcoding backend next to TorBox. This works for non-TorBox accounts too.
- Probing files and serving subtitles.

How it fits in: as a `StreamInfo` provider plugged into the same playback-mode logic, with a health check and a status card in Settings → Devices.

### Reference: Nuvio
`D:\Game Dev\GitHub\Nuvio Home\app` is the user's fork of Nuvio TV (VIDAA web app). Use it as the reference for:
- the TV/Big Picture interface: home rows, focus behaviour, detail and player screens, and profiles;
- the "locked stream" policy: once playback starts, never switch source automatically, and recover on the same file instead.

Copy its patterns, not its code, and keep our own structure.

### Phase 6 — Polish and checking it works everywhere
- A run through Status/compatibility on each device class: iPhone PWA, Android, desktop Chrome/Safari/Firefox, Android TV/Fire TV browser and Tizen/webOS where possible.
- Performance: shrink the large components (`legacy-video-preview.tsx` is over 3,100 lines) along the new boundaries between device frames.
- Update `docs/ui.md` / `ui-minimal.md` with the final patterns.

---

## 4. Decisions (2026-11-13)

1. **Profiles:** no PINs and no kid profiles. Addons and debrid accounts are shared across profiles. Device sync stays one per account (assumed, since the family shares devices).
2. **Trakt:** each profile connects its own Trakt account. Profiles without Trakt use local history.
3. **Other providers:** keep working fully; TorBox-only features are hidden for them.
4. **Harbor** is <https://github.com/Harborofficial/Harbor>. Nuvio (local) is the TV reference.
5. **Font:** keep the current one.
6. **Order:** as listed above.

## 5. How the work is done

- Each phase is split into tasks with separate file ownership and implemented by GPT-6.1 Sol (medium) subagents. They follow the project skills in `.claude/skills/`.
- Subagents don't commit, don't apply DB migrations and don't start the dev server. Claude reviews each diff, runs `bun run lint`, tests the interface (built-in browser preview for desktop/phone sizes, Android emulators for TV and tablet), then commits to `main`.
- The production login must work on local dev (`localhost:3000` uses prod Neon Auth).
