# Privacy Policy — Debrid VLC Bridge

**Last updated:** June 2025

## Overview

Debrid VLC Bridge is a Chrome extension that bridges the DebridUI web application with VLC media player running on your local machine. It does **not** collect, transmit, or store any personal data on external servers.

## Data Handling

### Data collected

- **VLC connection settings** (host, port, password): stored locally via Chrome's `storage.local` API. Never transmitted externally.

### Data NOT collected

- No browsing history
- No personally identifiable information
- No analytics or telemetry
- No cookies or tracking
- No user accounts or authentication tokens

## Network Communication

The extension communicates with exactly two destinations:

1. **VLC HTTP interface** at `localhost:8080` (or user-configured local address) — to send playback commands and receive player status.
2. **DebridUI web application** (the page you have open) — via Chrome's content script messaging to relay VLC status to the web app UI.

All communication is local. No data leaves your machine except the standard web traffic between your browser and the DebridUI web application, which is not initiated or modified by the extension.

## Permissions Justification

| Permission | Purpose |
|---|---|
| `storage` | Save VLC connection settings (host, port, password) locally |
| `alarms` | Periodic polling of VLC status at configurable intervals |
| `downloads` | Temporarily download subtitle files so VLC can load them from a local path |
| Host: `localhost:8080` | Communicate with VLC's HTTP API |

## Subtitle Downloads

When loading remote subtitles, the extension temporarily downloads the subtitle file to a local directory (`vlc-bridge-subs/`) so VLC can read it. These files are automatically cleaned up after VLC loads them. The download is erased from Chrome's download history immediately.

## Third-Party Services

This extension does not integrate with any third-party analytics, advertising, or tracking services.

## Changes

This privacy policy may be updated occasionally. Changes will be noted in the extension's changelog.

## Contact

For questions about this privacy policy, open an issue at:
https://github.com/Vansh-Bhardwaj/debridui/issues
