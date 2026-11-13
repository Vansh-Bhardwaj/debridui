---
name: debridui-device-ui
description: How DebridUI adapts its interface per device (phone, tablet, desktop, TV/Big Picture). Covers useDevice, per-device frames, the settings registry, TV d-pad focus and design tokens. Use for any UI work in the overhaul.
---

# Device-specific UI in DebridUI

## Device model (Phase 0 contract)
- `DeviceClass = "phone" | "tablet" | "desktop" | "tv"`, detected by the pure function `detectDeviceClass()` in `lib/device/detect.ts`. It uses the UA plus `navigator.userAgentData` (mobile, platform).
  - TV: Android TV / Google TV / `CrKey` / `SmartTV` / Tizen / Web0S / VIDAA / AFT (Fire TV) / BRAVIA / `TV` tokens.
  - Tablet: iPad (including iPadOS presenting as Mac with touch, refined on the client), and Android without `Mobile`.
  - Phone: `Mobile` UAs.
  - Everything else is desktop.
- Detection runs **only on the client** (`useSyncExternalStore`, server snapshot "desktop"). This keeps the `force-static` pages static, which matters for the Cloudflare CPU limits. Never read cookies or headers in layouts for this. App pages render after the client session check, so they never show the server value.
- A user override is stored in localStorage `dui-device-override` and wins over detection.
- **Client API:** `useDevice()` from `components/device/device-provider.tsx` returns `{ device, isPhone, isTablet, isDesktop, isTV, setOverride }`. Pages and components read **only this**. Don't add new `matchMedia`/UA checks, and don't use `useIsMobile` in new code.
- **Big Picture** (`hooks/use-tv-mode.ts`) is on automatically for `tv` and can be toggled on desktop. Shrinking the window never exits it.
- **Responsive CSS is still fine** for pure layout (grid columns etc.). Use `useDevice()` when **what** is shown changes, not just its size.

## Per-device frames (Phase 2)
- Phone: bottom tab bar, bottom sheets for menus and players, 44px minimum touch targets. No hover-only UI, no keyboard hints, no Big Picture toggle.
- Tablet: tab bar in portrait, icon sidebar in landscape.
- Desktop: sidebar, keyboard shortcuts, device picker.
- TV: top nav (`components/tv/tv-navigation.tsx`) where every route can be reached, `data-tv-focusable` on every interactive element, large type, a visible focus ring. Reference: Nuvio (`D:\Game Dev\GitHub\Nuvio Home\app`).
- Pages stay shared. Branch with `useDevice()` only where content differs, and prefer a small per-device component over many inline ternaries.

## Settings registry (Phase 2)
Each entry is `{ id, section, label, description?, devices: DeviceClass[], scope: "profile" | "device" | "account", requires?: "torbox" | "trakt" }`.
- The settings pages render from the registry filtered by the current device and account. Never hide an option by hand in JSX.
- Scope meaning:
  - `profile`: synced per profile on the server.
  - `device`: localStorage, this device only.
  - `account`: shared by the whole family.

## TV focus (`hooks/use-tv-focus.ts`)
- Spatial navigation over `[data-tv-focusable]`, grouped by `[data-tv-section]`. Up/down moves between sections, left/right moves within one.
- Every new interactive element visible in Big Picture needs `data-tv-focusable`. Every row or group needs `data-tv-section`.
- Back is Escape/Backspace, or B on a gamepad. Don't trap focus. Restore focus when a dialog closes.

## Design tokens (keep the look)
- Colours: OKLCH neutrals, gold `--primary`, green `--secondary`, red `--destructive`. Tokens live in `app/globals.css`.
- Flat: `--radius: 0`, no gradients, no heavy shadows. Font: Styrene B (keep it).
- Patterns: borders `border-border/50`, fills `bg-muted/30` (hover `/50`), labels `text-xs tracking-widest uppercase text-muted-foreground`, headings `font-light`, metadata inline with `·`.
- Device tokens (added in Phase 0, in `globals.css`): phone touch-target size, TV type scale, TV focus ring. Use them instead of ad-hoc sizes.
- Full reference: `docs/ui-minimal.md`, then `docs/ui.md`.
