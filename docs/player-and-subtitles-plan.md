# Plan: Video Player + Stremio-Aligned Subtitles

**Status:** Plan only — no implementation yet.  
**Goal:** Pick a robust player (**Video.js v10** preferred; Vidstack legacy), align with how Stremio web handles subtitles, and design regex/auto-naming and subtitle list UX before coding.

---

## 1. Video.js v10 — the convergence (primary choice)

### 1.1 Why Video.js v10 is the right "latest one"

In early 2026, **Vidstack, Media Chrome, and Plyr are converging into Video.js v10** under Mux and the Video.js team ([Mux blog](https://www.mux.com/blog/6-years-building-video-players-9-billion-requests-starting-over), [videojs/v10](https://github.com/videojs/v10/)).

- **Vidstack's DNA, without its limits:** Vidstack's creator (Rahim Alwer) joined Mux; the patterns that worked in Vidstack — Radix-like composition, state-down/events-up, compound components, accessibility — are being carried into v10. The pain points (web component friction, monolithic store, skin customization limits) are being addressed at the architectural level.
- **What v10 aims to deliver:** Framework-native feel (no web components shoehorned in), shadcn-style skins (copy source, own the code), truly modular from the ground up (tree-shake, pay only for features you use), React + Tailwind as lingua franca with a compiler for other frameworks. React Native is in scope from day one.
- **Timeline (from repo):** Alpha (Jan 2026) → Beta (Feb 2026) → GA (Mid 2026) → Video.js core/contrib parity and plugin migration (End 2026). A migration guide from Vidstack is planned at v10 launch.
- **For us:** Use **Video.js v10** (alpha/beta) for the spike and new implementation. It's the successor to the Vidstack direction we had in the plan; it has a team and a clear roadmap. We accept alpha/beta stability until GA if we integrate early.

### 1.2 Fit for our stack and requirements

- **Tech stack:** Next.js, React 19, TypeScript. v10 is "for Web and React"; we verify compatibility in a spike (alpha/beta may have rough edges).
- **Features we need:** Same as before — subtitles/captions (multiple formats), multi-audio, HLS/DASH, YouTube in one player, single API for debrid streams + trailers. v10 is being built with these in mind (Vidstack + Media Chrome + Plyr experience).
- **Bundle:** v10 is designed for true modularity and tree-shaking; exact numbers TBD from alpha.
- **Licensing:** Video.js is Apache 2.0; v10 repo is open source.

### 1.3 Version strategy

- **Primary:** **Video.js v10** from [github.com/videojs/v10](https://github.com/videojs/v10/). Docs/site: v10.videojs.org. Use alpha (or beta when available) for spike; track releases and migration notes.
- **Fallback:** If v10 alpha/beta is too unstable for our timeline, we can short-term use **Vidstack** (vidstack package, 1.0-RC) with the understanding that the long-term path is v10 (migration guide expected). Vidstack is not abandoned but is evolving into v10.
- **Spike:** One page with Video.js v10, one video URL, one proxied subtitle track, and one YouTube URL; document package name, version, and any React 19/Next.js quirks.

---

## 2. Vidstack (legacy / fallback)

If we need a player before v10 is viable:

- **Vidstack** (vidstack package, 1.0-RC) still offers: HLS, DASH, YouTube, captions (VTT, SRT, SSA), multi-audio hooks, ~54kB gzip core. React + Next.js support; confirm React 19.
- **Caveat:** Vidstack's future is Video.js v10; any Vidstack integration should be done with an eye to migrating when v10 is stable and the migration guide is available.

---

## 3. How Stremio web handles subtitles (to align with)

### 3.1 Stremio addon protocol (subtitles)

- **Endpoint:** `/subtitles/{type}/{id}.json` (e.g. movie by imdb id, series by `id:s:e`).
- **Request:** `type`, `id`, optional `extra`: `videoHash`, `videoSize`, `filename` (used by some addons for matching).
- **Response:** `{ subtitles: Subtitle[] }`; optional `cacheMaxAge`, `staleRevalidate`, `staleError`.
- **Subtitle object (official):**
  - `id` — **required**, string, unique per track (disambiguates same language from same addon).
  - `url` — **required**, string, subtitle file URL.
  - `lang` — **required**, string. If **valid ISO 639-2** → used as language code; otherwise the **literal text is used as the display label** (so addons can send "English" or "English (SDH)").
- **Our types today:** We have `AddonSubtitle` with `url`, `lang`, optional `name`. Protocol does not define `name`; many addons use `lang` for both code and label, or send a human-readable string in `lang`.

### 3.2 Typical Stremio subtitle issues

- **CORS:** Subtitle URLs are often on addon domains (e.g. subs5.strem.io). Browser blocks cross-origin track loads. **Fix:** Proxy subtitle URLs through our backend or CORS proxy (we already use a proxy for addon subs).
- **Encoding:** Addons may return non-UTF-8 SRT. Stremio docs suggest proxying via a local endpoint that guesses encoding; we can proxy and serve UTF-8 (or convert SRT→VTT in proxy if needed).
- **Multiple addons:** Stremio requests subtitles from **all** installed subtitle addons and merges results. We already aggregate from multiple addons in `useAddonSubtitles`; we should **deduplicate** by something like `(lang, url)` or `id` when present.
- **Selection UX:** Stremio shows a list of tracks (language/label); user picks one. We need a clear **subtitle list** in the player (or a picker that feeds the player).

### 3.3 What we need to "understand like Stremio web"

- **Request:** We already pass `imdbId`, `mediaType`, `tvParams` (season/episode). We do **not** send `videoHash` or `filename` to addons; adding them later could improve matching for addons that use `extra`.
- **Response handling:** Normalise and display every track:
  - Prefer **display label**: if addon sends a readable string in `lang` (not a 2/3 letter code), use it as label; otherwise map `lang` (e.g. ISO 639-2) to a language name (i18n or a small map).
  - Use `id` when present for uniqueness and deduplication.
- **List building:** Merge subtitles from all addons → normalise labels → sort (e.g. by language, then by addon) → show in UI; one "default" (e.g. first or user's preferred language).

---

## 4. Regex and auto track naming

### 4.1 Where naming matters

- **Addon response:** `lang` (and optional `name` in our type) — we need a **single display string** per track for the subtitle list (e.g. "English", "Spanish (Latin America)").
- **Optional: filename-based hints:** If we ever get a **filename** (e.g. from stream or from our own file node), we could derive a hint (e.g. "1080p", "Extended") via regex; this is secondary and not in the Stremio subtitle object.
- **Deduplication:** Same `url` or same `(lang, addonId)` might appear from multiple addons; we need stable keys (e.g. `id` if present, else `url`, else `lang + index`).

### 4.2 Proposed approach (no implementation yet)

- **Normalise label:**
  - If addon sends `name`, use it (trimmed).
  - Else if `lang` looks like a 2/3 letter code (regex e.g. `^[a-z]{2,3}$`), map to language name (ISO 639-1/639-2 table or i18n).
  - Else use `lang` as display text (Stremio behaviour).
- **Optional regex for filenames (later):** If we have a stream/file name, we could use a small set of patterns to extract tags (e.g. resolution, "Extended", "Director's Cut") and append to label; low priority.
- **Stable id per track:** `id` from addon if present; otherwise generate one (e.g. `hash(lang + url)` or `addonId + lang + index`) for React keys and deduplication.

---

## 5. Subtitles list and UX

- **Source of list:** Current `useAddonSubtitles` already returns a combined list from all addons; we will keep that and add normalisation + deduplication as above.
- **Where to show:** In the player UI (Video.js v10 / Vidstack provide caption/track menu components) or a small "Subtitles" dropdown next to the player that sets the active track.
- **Default:** First track, or first matching user's preferred language if we add a preference later.
- **CORS:** Keep using our proxy for every subtitle `url` before passing to the player (same as current approach).
- **Formats:** Addons usually return SRT URLs; we may need to ensure proxy returns a type the player accepts (Vidstack/v10 support SRT; browser `<track>` often expects VTT — confirm player behaviour for SRT URLs).

---

## 6. Implementation phases (order only)

1. **Discovery / spike**
   - Prefer **Video.js v10** (alpha/beta from [github.com/videojs/v10](https://github.com/videojs/v10/)); fallback to Vidstack 1.0-RC if v10 is not yet usable.
   - Confirm package name, version, and Next.js + React 19 compatibility.
   - Minimal test: one page with the chosen player, one video URL, one subtitle track (proxied), and one YouTube URL.
   - Document any compatibility issues and version lock.

2. **Stremio behaviour doc (internal)**
   - Short doc or section in this file: request/response for subtitles, `id`/`url`/`lang` handling, CORS and encoding notes, and how we map to our `AddonSubtitle` and display labels.

3. **Subtitle pipeline (no player change yet)**
   - Normalise addon subtitle response: label from `name` / `lang` (with regex or code for ISO 639), stable `id`, deduplication.
   - Optional: add `videoHash`/`filename` to addon subtitle requests if we have them and if addon manifest supports it (later).

4. **Player swap**
   - Replace current video preview with Video.js v10 (or Vidstack fallback): file + HLS/DASH + YouTube, keep same props surface (url, subtitles array, codec warning / "open in VLC" flow).
   - Wire our normalised subtitle list into the player's text tracks / captions API.
   - Ensure "Open in VLC/MPV/IINA" still pauses and opens current URL in external player (no default change).

5. **Trailer in same player**
   - "Watch Trailer" opens preview with YouTube URL in the same player (single mode with `directUrl` = YouTube link); no new tab.

6. **Polish**
   - Subtitle picker in player UI (if not already provided by the chosen layout).
   - Subtitles on auto-play path (fetch in streaming store when resolving best source and pass to preview).

---

## 7. References

- **Video.js v10:** https://github.com/videojs/v10 — Technical preview; Alpha (Jan 2026), Beta (Feb 2026), GA (Mid 2026).
- **Mux blog (Vidstack → Video.js v10):** https://www.mux.com/blog/6-years-building-video-players-9-billion-requests-starting-over
- Vidstack (fallback): https://vidstack.io/docs/player ; React install: https://vidstack.io/docs/player/getting-started/installation/react
- Stremio addon protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
- Stremio defineSubtitlesHandler: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md
- Stremio Subtitle object: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md
- Our addon types: `lib/addons/types.ts` (`AddonSubtitle`, `AddonSubtitlesResponse`)
- Our improvements backlog: `docs/improvements.md`
