---
name: debridui-ui-verify
description: How the reviewer checks DebridUI changes in a real browser and Android emulators (phone, tablet, TV). Covers the dev server, login and the per-device checklist. Use when verifying UI work before committing.
---

# Verifying DebridUI UI changes

## Setup
- Dev server: `bun run dev` (bun at `~/.bun/bin`) on http://localhost:3000. It uses the production Neon Auth and production database, so the production login works locally.
- Credentials: ask the user or use the ones they gave in the conversation. **Never write them to files, skills, commits or subagent briefs.**
- Desktop and phone sizes: the built-in browser preview (`preview_*` tools). Resize to 390×844 for phone, 1024×768 for tablet and 1440×900 for desktop.
- Android: T3 device tools (`device_list` → `device_open` → the returned `agent-device` command). AVDs: `RiddleTiles_TV_API36` (TV), `RiddleTiles_Tablet_API36`, `RiddleTiles_Fold_API36`. From inside the emulator, the dev server is at `http://10.0.2.2:3000`.
- The emulator browser isn't a secure context on `10.0.2.2`. If a feature needs one (service worker, clipboard), use `adb reverse tcp:3000 tcp:3000` and open `http://localhost:3000`.

## Per-change checklist
1. `bun run lint` is clean, and `bun test` passes for the touched tests.
2. The page renders on phone, tablet, desktop and TV with no layout flash. The right navigation frame shows for each device.
3. Options that don't apply to a device are absent, not just disabled.
4. TV: every control can be reached with the d-pad, the focus ring is visible, and Back works.
5. Profiles: after switching profile, history, continue watching and Trakt change, while addons and accounts don't.
6. A non-TorBox account still lists files and plays, and TorBox-only UI is hidden for it.
7. Close any preview tab you opened before replying.
