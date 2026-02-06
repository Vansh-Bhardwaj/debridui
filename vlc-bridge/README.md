# Debrid VLC Bridge

Browser extension that lets the debridui web app control VLC media player.

## Architecture

```
┌─────────────┐  CustomEvent / externally_connectable  ┌────────────────┐
│  debridui   │ ◄─────────────────────────────────────► │   Extension    │
│  web app    │                                         │  (MV3 SW)     │
└─────────────┘                                         └───────┬────────┘
                                                                │
                                                      fetch (CORS bypass)
                                                                │
                                                                ▼
                                                       ┌──────────────┐
                                                       │  VLC HTTP    │
                                                       │  Interface   │
                                                       │  :8080       │
                                                       └──────────────┘
```

## Features

| Feature | How |
|---------|-----|
| Play any URL in VLC | VLC HTTP API `in_play` |
| Load subtitles from URL | `addsubtitle` command |
| Playback controls | pause, resume, seek, volume, next/prev |
| Track selection | Audio, subtitle, video tracks |
| Progress sync | Poll VLC status → push to web app |
| Subtitle delay | `subdelay` command |
| Playback rate | `rate` command |

## Installation

### 1. Download the extension

**From GitHub Releases (recommended):**
1. Go to [Releases](https://github.com/Vansh-Bhardwaj/debridui/releases)
2. Download the latest `debrid-vlc-bridge-v*.zip`
3. Extract the zip to a permanent folder (don't delete it after loading)

**From source:**
1. Clone this repo
2. The extension files are in `vlc-bridge/extension/`

### 2. Load in Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the extracted folder (or `vlc-bridge/extension/`)
4. The extension icon appears in your toolbar

### 3. Enable VLC HTTP interface

**Option A — Permanent (recommended):**
1. VLC → Tools → Preferences
2. Bottom-left: Show settings → **All**
3. Interface → Main interfaces → check **Web**
4. Main interfaces → Lua → set password to `vlcbridge`
5. Save & restart VLC

**Option B — Quick launch (Windows):**
Double-click `start-vlc.bat` in the `vlc-bridge/` folder, or run:
```
vlc --extraintf http --http-password vlcbridge
```

### 4. Configure the web app (optional)

Set the extension ID in your `.env.local` (only needed if using direct transport):

```
NEXT_PUBLIC_VLC_BRIDGE_EXTENSION_ID=your-extension-id-here
```

> **Note:** The content script bridge (default) auto-detects the extension — no ID is needed. This env var is only for the direct `chrome.runtime.sendMessage` fallback.

## Usage in debridui

### React hook

```tsx
import { useVLCBridge } from "@/hooks/use-vlc-bridge";

function Player({ streamUrl }: { streamUrl: string }) {
  const {
    available,
    vlcRunning,
    isPlaying,
    play,
    addSubtitle,
    startPolling,
    detect,
  } = useVLCBridge();

  const handlePlay = async () => {
    if (!available) {
      await detect();
      return;
    }
    await play(streamUrl, { subtitles: ["https://example.com/subs.srt"] });
    startPolling();
  };

  return (
    <button onClick={handlePlay}>
      {isPlaying ? "Playing in VLC" : "Play in VLC"}
    </button>
  );
}
```

### Direct client

```ts
import { VLCBridgeClient } from "@/lib/vlc-bridge";

const vlc = new VLCBridgeClient();
await vlc.detect();
await vlc.play("https://example.com/video.mp4");
await vlc.addSubtitle("https://example.com/subs.srt");

const { data: status } = await vlc.getStatus();
console.log(status.time, status.length);
```

## Extension Popup

The popup shows:
- VLC connection status (green/red indicator)
- Now playing info (title, progress bar, time)
- Basic media controls (prev, play/pause, stop, next)
- Settings (port, password)
- Setup guide with CLI command

## VLC HTTP API Reference

The extension communicates with VLC via its built-in HTTP interface on `127.0.0.1:8080`.

Key endpoints:
- `GET /requests/status.json` — current playback state
- `GET /requests/status.json?command=<cmd>&val=<val>` — send command
- `GET /requests/playlist.json` — playlist contents

## Chrome Web Store Compliance

This extension follows all Chrome Web Store policies:

- **Single purpose**: Bridge between debridui and VLC media player
- **Minimal permissions**: Only `storage`, `alarms`, `downloads`, and `host_permissions` for localhost
- **No data collection**: All data stays local. No analytics, no remote servers.
- **Transparent**: Open source, clear documentation

### Privacy Policy

This extension:
- Does NOT collect any personal data
- Does NOT transmit data to any remote server
- Only communicates with VLC running on localhost (127.0.0.1)
- Stores only VLC connection settings (port, password) locally via `chrome.storage`

## Development

### Extension structure

```
extension/
├── manifest.json    # MV3 manifest
├── background.js    # Service worker — VLC API + message routing
├── content.js       # Content script — CustomEvent bridge
├── popup.html       # Popup UI
├── popup.js         # Popup logic
└── popup.css        # Popup styles
```

### Testing the connection

1. Open VLC with HTTP interface: `vlc --extraintf http --http-password vlcbridge`
2. Verify: `curl http://:vlcbridge@127.0.0.1:8080/requests/status.json`
3. Load the extension and open the popup
4. The status dot should turn green

### Publishing to Chrome Web Store

1. Run `node build-zip.js` from the `vlc-bridge/` directory
2. Go to https://chrome.google.com/webstore/devconsole
3. Click "Add new item" and upload the generated zip
4. Fill in listing details from `STORE_LISTING.md`
5. Add the privacy policy from `PRIVACY_POLICY.md`
6. Submit for review

See `STORE_LISTING.md` for complete listing text, permission justifications, and test instructions.

## License

Same as the debridui project.
