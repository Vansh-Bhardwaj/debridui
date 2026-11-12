# iOS browser playback

On iPhone and iPad, tapping Play requests Apple's native fullscreen video player. The fullscreen button also uses the native video API when available. Exiting fullscreen returns to the page; playback progress continues to use the same video element.

Unlike desktop and Android playback, iOS does not set `playsinline` or `webkit-playsinline`. Requests to `webkitEnterFullscreen()` run synchronously in the tap handler, without awaiting `play()`. Safari can reject fullscreen before metadata loads; on iPhone, playback without `playsinline` also enters fullscreen automatically.

Selected subtitles are copied into a native text track because the HTML caption overlay cannot appear over Apple's player. Cue times include subtitle delay, speed, and sync anchors. Styling and controls in native fullscreen are managed by iOS.

Native fullscreen uses Safari's existing decoders. It does not add MKV, DTS, or TrueHD support. Use the provider's compatible HLS stream for files Safari cannot open; unsupported files without a compatible provider stream still need another source or an external player. This change adds no server-side conversion or dependencies.

## Verify on an iPhone and iPad

1. Open Safari and play a supported MP4, then a TorBox compatible HLS stream. Confirm Apple's fullscreen controls appear after the tap.
2. Pause, seek, and close native fullscreen. Confirm playback position and continue-watching progress remain correct.
3. Reopen with the fullscreen button. Confirm the button's state resets after closing Apple's player.
4. Select an addon subtitle before playing. Confirm captions appear in fullscreen and turning them off in the app removes them. Repeat with a subtitle delay and embedded HLS captions.
5. In iPad desktop website mode, confirm playback follows the iOS path and external player options use iOS links.
6. Check desktop and Android still use inline playback and the existing custom fullscreen player.

## References

- [WebKit video policies: user gestures and inline versus fullscreen playback](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- [WebKit Managed Media Source requirements](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/) — relevant to future on-device conversion support; this change preserves native HLS playback.
