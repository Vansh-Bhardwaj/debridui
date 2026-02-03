# Improvement ideas and roadmap

Collected from a deep pass over the codebase and Stremio addon alignment. Not all items are planned; use as a backlog.

---

## Done in this pass

### Subtitles from addons (Stremio protocol)
- **Addon types**: `AddonSubtitle`, `AddonSubtitlesResponse` in `lib/addons/types.ts`.
- **Addon client**: `fetchSubtitles(imdbId, mediaType, tvParams?)` — calls `/subtitles/movie/{id}.json` or `/subtitles/series/{id}:s:e.json`.
- **Hook**: `useAddonSubtitles({ imdbId, mediaType, tvParams })` — only queries addons that declare `resources` containing `"subtitles"`.
- **UI**: When you click **Play** from the Sources panel (movie/show detail), subtitles from addons are fetched and passed to the browser video preview; the native `<video>` element gets `<track kind="subtitles">` entries so the user can pick a track in the player.
- **Limitation**: Subtitles are only attached when playing from the **Sources** component (we have imdbId + type + tvParams there). Auto-play / toast “Play” path does not yet pass subtitles (would require fetching subtitles in the streaming store when resolving the best source).

---

## Addon / Stremio alignment

- **Meta resource**: Stremio addons can expose a `meta` resource (movie/series metadata: title, poster, cast, etc.). We currently use Trakt for metadata; addons could be an optional or fallback source for meta.
- **Catalog resource**: Addons can expose `catalog` (lists of items). We don’t use catalog today; could support “discover via addon” later.
- **Manifest `resources`**: We only check for `subtitles` in manifest `resources`. Other resources (stream, meta, catalog, etc.) are implied by our usage; no need to change unless we add meta/catalog.
- **Subtitles CORS**: Subtitle URLs from addons may be on other origins. If the browser blocks them, we may need to proxy subtitle URLs through our CORS proxy or serve them from our backend.

---

## UX / product

- **Subtitle picker in UI**: Show a small “Subtitles” dropdown in the video preview (or near the Play button) that lists addon-provided tracks and passes the selected one to the video (or pre-select “first”).
- **Subtitles on toast/auto-play**: In `streaming.play()`, after selecting the best source, fetch subtitles (imdbId + type + tvParams from `activeRequest`) and pass them into `playSource(..., { subtitles })` so browser preview gets tracks for auto-play too.
- **Catalog from addons**: Optional “Browse addon catalog” in addition to Trakt-based discovery.
- **Streaming quality preference**: Persist “prefer cached” / “prefer resolution” in settings and surface in source selector and UI.

---

## Technical / codebase

- **Preview registry typing**: `PreviewRendererComponent` could extend to an optional `subtitles?: AddonSubtitle[]` prop so only video (and future) renderers declare it.
- **Error boundaries**: Add error boundaries around major sections (sidebar, main content, preview dialog) to avoid full-app crash and show a fallback.
- **Health check on status page**: Optionally call `/api/health` from the status page with a timeout and show “fetch error” if the request fails (we already show raw JSON; could add a “last fetch failed” state).
- **Addon timeout**: Addon client has a 3‑minute timeout; consider a lower default for stream/subtitles (e.g. 15–30s) and keep 3m for manifest if needed.

---

## References

- [Stremio addon protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
- [Stremio addon guide](https://stremio.github.io/stremio-addon-guide/)
- Subtitle response: addon returns `{ subtitles: [{ url, lang, name? }] }` for `/subtitles/{type}/{id}.json`.
