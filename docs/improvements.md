# Player & streaming improvements roadmap

Concrete, code‑driven improvements for our current HTML5 player + addons setup. iOS is explicitly out of scope for now.

---

## Phase 1 – Player UX polish (browser only)

- **Unified play / pause / loading state**
  - Keep the current big center button + bottom-left play button as the single source of truth for state:
    - Loading: spinner on both.
    - Playing: pause icon.
    - Paused: play icon.
  - No separate loading overlays except when subtitles are being prepared before the first frame.

- **Keyboard & mouse parity with YouTube**
  - Confirm and document:
    - Space / K: play / pause.
    - Arrow left/right: ±5s seek.
    - Arrow up/down: volume.
    - F: fullscreen.
    - C: cycle subtitles.
  - Add:
    - J / L: ±10s seek.
    - `,` / `.`: small ±0.5s seek when paused.
  - Double‑click anywhere on the video toggles fullscreen (already partly implemented, keep as spec).

- **Codec warning UX**
  - Keep existing codec warning component but ensure it never blocks playback UI and can be dismissed per‑session.

---

## Phase 2 – Continue watching & progress tracking

- **DB model**
  - Add a `user_progress` table (per logged‑in user) with:
    - `userId` (FK to `user`).
    - `imdbId`, `type` (`movie` | `show`), optional `season`/`episode`.
    - `progressSeconds`, `durationSeconds`, `updatedAt`.
  - One row per user + per logical item (movie or episode).

- **Writing progress**
  - Extend `legacy-video-preview` to accept an optional `progressKey` object (`{ imdbId, type, season?, episode? }`).
  - On `timeupdate`, throttle and POST the latest `currentTime` + `duration` to an API route backed by `user_progress`.

- **Continue watching UI**
  - Home/dashboard: add a **“Continue watching”** row above existing recommendations.
    - For each progress row where `progressSeconds / durationSeconds` is between, e.g., 5% and 90%, show a card:
      - Poster from Trakt.
      - Progress bar based on stored ratio.
  - Clicking a card:
    - Calls the same `WatchButton` flow, but with a `startFromSeconds` hint passed through to the player so it seeks immediately after first frame.
  - As an earlier, low-effort step, we can also offer device-local resume using `localStorage` with the same key shape, without waiting for the DB layer.
  - When adding DB-backed progress, keep writes cheap for Neon/Cloudflare:
    - Upsert on **coarse intervals** only (e.g. every 30–60 seconds or on pause/end), and avoid per-second updates.

---

## Phase 3 – Smarter auto stream selection & in‑player source switch

- **Source selector (in player)**
  - In the player UI, add a compact **“Source”** menu instead of listing every stream:
    - Show **current** stream (resolution, quality, addon).
    - Offer **1–3 alternative picks** per our existing `selectBestSource` logic:
      - Prefer original audio language, then user quality profile, then cached.
    - Avoid dumping the full raw addon list.
  - Implementation:
    - Extend `playSource` to optionally receive the full `AddonSource[]` list that was used for selection.
    - Use `selectBestSource` with different `allowUncached` / quality preferences to produce “Best”, “Next best”, etc., and display only those IDs in the menu.
    - Prefer streams from the same addon whose subtitles we are using when multiple options are otherwise equivalent.

- **Language‑aware best pick**
  - Enhance `selectBestSource` scoring to:
    - Prefer streams whose detected audio language matches:
      - First: original show/movie language from Trakt.
      - Then: user’s preferred audio language from settings (when added).
    - Only then apply resolution / quality rules (existing `StreamingSettings` and `getActiveRange`).

---

## Phase 4 – Episode navigation & collections

- **Episode context**
  - Extend `WatchButton` and `StreamingRequest` to optionally include:
    - `season`, `episode`, and information about the **current file collection** (if we know the torrent contained multiple episodes).

- **Next / previous episode detection**
  - When the current playback completes:
    - If we have a file collection for the original torrent:
      - Use filename patterns + episode numbers to find the next/previous episode in that same collection.
      - Skip any obviously non‑episode extras.
    - If not:
      - Use existing addons + `selectBestSource` to resolve the best stream for the next/previous episode by Trakt metadata (season/episode list).

- **In‑player navigation**
  - Add “Next episode” / “Previous episode” buttons to the player bar when we have resolvable neighbors.
  - Show a small “Next episode starting in 10… Skip / Cancel” overlay near the end of the current episode.

---

## Phase 5 – Settings surface for these features

- **New settings stored in `user_settings`**
  - `playback`:
    - Default playback speed.
    - Default subtitle size.
    - “Resume from last position when available”.
  - `streaming`:
    - Preferred audio language.
    - Whether to prefer cached sources over best quality.
     - Whether to auto-play when a suitable source is found.

- **Sync with existing stores**
  - Wire these into `useSettingsStore` so they auto‑persist via the existing JSONB `user_settings` row and hydrate into the player and streaming store.

---

## Phase 6 – Account & security essentials

- **Forgot / reset password**
  - Add a “Forgot password?” flow for email/password users (not required for Google login).
  - API + UI:
    - Request reset: user enters email → we send a one‑time, short‑lived token link.
    - Reset page: token + new password → verify token, update password, invalidate token.

- **OTP verification for signup & sensitive actions**
  - On email signup (non‑Google):
    - Send a numeric OTP to the user’s email.
    - Require OTP verification before activating the account.
  - On password change:
    - Require either current password **or** a fresh OTP to confirm the change.
  - Google login users skip OTP for signup (Google already handles identity), but may still use OTP for password‑based actions if they later add a local password.

These auth features are independent of the player work but necessary for a production‑ready app and can be implemented alongside the phases above.

These phases only use capabilities we already have (HTML5 player, Trakt metadata, addons, logged‑in users, PostgreSQL via Drizzle) and avoid large external player rewrites.***
