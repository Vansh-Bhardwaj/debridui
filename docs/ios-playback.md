# Device playback routes

`lib/playback/device-profile.ts` detects the device once and picks a route.

| Device | Player | What plays |
| --- | --- | --- |
| iPhone / iPad (any iOS browser) | `NativeVideoPreview` — Apple's `<video controls>` | Provider's converted HLS stream. MP4 originals only when no stream exists. MKV is never tried. |
| Mac Safari | Custom player | MP4 originals; MKV and undecodable codecs only via the converted stream (Safari's built-in HLS). |
| Chrome / Edge / Firefox / Android | Custom player | Original when the browser can open and decode it; otherwise only the converted stream (hls.js), or on-device Dolby conversion. |

Rules shared by every route:

- **No doomed starts.** When the device can't play the original (`getOriginalIssue`), the player waits for the provider lookup (max 30s) instead of starting the file and failing.
- **Early lookup.** Picking a source starts the TorBox lookup in parallel with resolving the addon URL (`prefetchStreamLinks`). The client caches the library listing (60s) and stream sessions (2 min), so the player reuses the result.
- **Library matching.** Debrid-configured addons drop `infoHash`, so the source is matched to the TorBox library by the hash in its resolve URL, then by the addon's exact byte size (`behaviorHints.videoSize`), then by file name. Season packs never fall back to "largest file".
- **Audio language.** TorBox defaults to the first audio track. The stream is re-requested in the user's preferred language (Settings → Streaming) because native HLS players only receive one track.
- **Source ranking.** On browsers that can't open MKV, MKV sources rank lower (softened when the provider can convert them).

## iPhone / iPad player

Apple's controls handle play, fullscreen, AirPlay, PiP and captions. Without `playsinline`, iPhone opens Apple's fullscreen player on play. The bar under the video offers what native controls can't: audio language and quality (new TorBox session at the same position), addon subtitles (added as a native text track), and previous/next. If nothing playable exists, the player shows why, with "Try another source" and Infuse/VLC/Kodi.

Phones on the custom player get bottom-sheet menus with 44px rows (`app/globals.css`).

## Verify on a device

1. iPhone: play an MKV from addons and from Files. Expect "Preparing a stream for iPhone", then Apple's player, in your audio language.
2. Change audio language and quality mid-play; position is kept.
3. Pick a subtitle; it appears in Apple's player and its CC menu.
4. Settings → Streaming shows "This device" with the route.
5. Desktop Chrome: MKV with AAC plays the original; E-AC-3/DTS switches to the converted stream without trying the file first.

## References

- [WebKit video policies](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- [TorBox API](https://api-docs.torbox.app/)
