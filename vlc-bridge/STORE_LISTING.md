# Chrome Web Store Listing — Debrid VLC Bridge

## Store Listing Details

### Name
Debrid VLC Bridge

### Short Description (132 chars max)
Control VLC media player from DebridUI — playback controls, subtitle management, and progress sync.

### Detailed Description
Debrid VLC Bridge connects the DebridUI web application to VLC media player running on your computer. Play media through VLC with full remote control from your browser.

**Features:**
• One-click playback — Play any media from DebridUI directly in VLC
• Full playback controls — Play, pause, seek, volume, and playback speed
• Subtitle management — Load remote subtitles, switch audio and subtitle tracks
• Progress sync — Your watch progress is automatically saved and synced
• Episode navigation — Next/previous episode support for TV shows
• Mini player — Compact in-browser controls while VLC plays your content

**How it works:**
1. Enable VLC's HTTP interface (one-time setup, guide included in the extension)
2. Open DebridUI in your browser
3. Click play on any title — it opens in VLC with full browser-based controls

**Requirements:**
• VLC media player with HTTP interface enabled (port 8080)
• DebridUI web application (https://debrid.indevs.in)

**Privacy:**
This extension communicates only with VLC on localhost. No data is collected or sent to external servers. See our full privacy policy for details.

### Category
Productivity

### Language
English

## Privacy Tab

### Single Purpose Description
Bridge between the DebridUI web application and VLC media player — sending playback commands to VLC's local HTTP interface and relaying player status back to the browser UI.

### Permission Justifications

| Permission | Justification |
|---|---|
| storage | Stores VLC connection settings (host, port, password) locally so the user doesn't need to reconfigure on every browser session |
| alarms | Polls VLC's HTTP status endpoint at regular intervals to keep the player state synchronized with the browser UI |
| downloads | Temporarily downloads remote subtitle files to disk so VLC can load them via local file path (files are auto-cleaned) |
| Host: localhost:8080 | Required to communicate with VLC's built-in HTTP API for sending playback commands and receiving player status |

### Data Usage Disclosures
- **Does not collect personal data**
- **Does not transmit data to external servers**
- **Does not use cookies**
- **Does not store authentication credentials** (VLC HTTP password is a local service password, not a user account)

## Distribution Tab

### Visibility
Public

### Regions
All regions

## Test Instructions

To test this extension, the reviewer needs VLC media player installed:

1. Install VLC media player (https://www.videolan.org/)
2. Enable VLC HTTP interface:
   - Open VLC → Tools → Preferences
   - Show settings: All (bottom-left)
   - Interface → Main interfaces → check "Web"
   - Main interfaces → Lua → set password to "vlcbridge"
   - Save & restart VLC
3. Load the extension in Chrome
4. Click the extension icon — should show "Connected" status
5. Visit https://debrid.indevs.in or http://localhost:3000
6. Play any media — it should open in VLC with controls in the browser

Alternatively, paste any direct media URL in the extension popup's URL field and click "Play" to test basic VLC communication.

## Required Assets

### Screenshots (1280x800 or 640x400)
- Screenshot 1: Extension popup showing connected status with now-playing info
- Screenshot 2: Extension popup showing playback controls and progress bar
- Screenshot 3: Mini player in the DebridUI web app
- Screenshot 4: Setup guide in the disconnected state

### Promotional Images
- Small tile: 440x280 (optional but recommended)

### Icon
- 128x128 PNG (already in icons/icon128.png)
