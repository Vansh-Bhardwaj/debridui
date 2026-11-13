# Editorial Minimalism — Quick Reference

Source of truth: `app/globals.css` and `components/ui/`. See [ui.md](./ui.md) for the full token table and component defaults.

## Keep the look

- Styrene B, loaded by `@font-face` in `globals.css` (400 and 700); Inter is a fallback. Other requested weights may be synthesized.
- Square corners everywhere: `--radius: 0rem`; `--radius-sm/md/lg/xl` each map directly to `var(--radius)`. These classes do not create different corner sizes.
- OKLCH neutrals, gold primary, green secondary, red destructive. No new gradients or heavy shadows.
- Labels: `text-xs tracking-widest uppercase text-muted-foreground`; headings: `font-light`.
- Borders: `border-border/50`. Fills: `bg-muted/30`, hover `bg-muted/50`. Metadata: inline text separated by `·`.

## Core colours

Exact values from `globals.css`; [full palette](./ui.md#colour-tokens) includes foreground pairs, charts and sidebar tokens.

| Token | `:root` (light) | `.dark` |
| --- | --- | --- |
| `--background` | `oklch(0.9911 0 0)` | `oklch(0.199 0 0)` |
| `--foreground` | `oklch(0.2046 0 0)` | `oklch(0.947 0 0)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.255 0 0)` |
| `--muted` | `oklch(0.931 0 0)` | `oklch(0.3 0 0)` |
| `--muted-foreground` | `oklch(0.5417 0 0)` | `oklch(0.706 0 0)` |
| `--border` | `oklch(0.9006 0 0)` | `oklch(0.364 0 0)` |
| `--primary` | `oklch(0.8696 0.1559 89.1782)` | `oklch(0.87 0.156 89.2)` |
| `--secondary` | `oklch(0.6406 0.1329 157.6795)` | `oklch(0.641 0.133 157.6)` |
| `--destructive` | `oklch(0.6256 0.1933 23.0261)` | `oklch(0.625 0.193 22.9)` |

## Primitives and sizing

Use existing shadcn components first. Read their source before adding overrides; defaults vary by component.

| Component / size | Actual default |
| --- | --- |
| Button `xs` / `sm` / `default` / `lg` | `h-6` / `h-8` / `h-9` / `h-10` (24 / 32 / 36 / 40px) |
| Button `icon-xs` / `icon-sm` / `icon` / `icon-lg` | `size-6` / `size-8` / `size-9` / `size-10` |
| Input | `h-9`; no component size variant (`size` is the native HTML attribute) |
| SelectTrigger `sm` / `default` | `h-8` / `h-9` |
| Button / Input transitions | `duration-200`, `ease-premium` |
| Badge | Outline variant by default; `text-xs tracking-wide`, `duration-300` |
| Card / Skeleton | `border-border/50` with light title / `bg-muted/50 animate-pulse` |

Prefer existing sizes; add token-based minimum dimensions for touch controls. Icons generally use `size-4`, section icons `size-5`, page icons `size-6`. Spacing uses `--spacing: 0.25rem` (4px at a 16px root).

## Device classes

Contract: [device-ui skill](../.claude/skills/debridui-device-ui/SKILL.md). The Phase 0 `useDevice()` API and Phase 2 frames are the contract for new UI; this document does not implement them.

| Class | Frame contract |
| --- | --- |
| Phone | Bottom tabs, bottom sheets for menus/players, minimum 44px touch targets; no hover-only UI, keyboard hints or Big Picture toggle |
| Tablet | Portrait tab bar; landscape icon sidebar |
| Desktop | Sidebar, keyboard shortcuts, device picker; Big Picture can be toggled |
| TV | Top navigation reaching every route, large type and visible focus ring; Big Picture automatically enabled |

Use `useDevice()` from `components/device/device-provider.tsx` when **what is shown** changes. It returns `{ device, isPhone, isTablet, isDesktop, isTV, setOverride }`. Keep pages shared and extract small device variants. Use responsive CSS for layout sizes and grid columns; do not add UA checks, `matchMedia` detection or new `useIsMobile` calls. Shrinking a desktop window must not exit Big Picture.

| Token | Value | Usage |
| --- | --- | --- |
| `--phone-touch-target` | `44px` | `min-h-phone-touch min-w-phone-touch` |
| `--tv-text-base` | `1.5rem` (24px) | `text-tv-base` |
| `--tv-text-title` | `2.25rem` (36px) | `text-tv-title` |
| `--tv-text-hero` | `3.5rem` (56px) | `text-tv-hero` |
| `--tv-focus-ring-color` | `var(--primary)` | Gold outline |
| `--tv-focus-ring-width` | `3px` | Default TV outline width |
| `--tv-focus-ring-offset` | `4px` | Default TV outline offset |

The type scale is opt-in for new 10-foot UI; existing `[data-tv-mode]` typography is unchanged. Touch minimums are opt-in too; primitive defaults remain smaller. TV nav keeps its 2px outline with zero offset; list rows keep a 2px, 60% primary outline inset by 2px.

Every interactive element visible in Big Picture needs `data-tv-focusable` on an actually focusable element; every row/group needs `data-tv-section`. Up/down moves between sections, left/right within one. Back is Escape/Backspace or gamepad B. Do not trap focus; restore it when a dialog closes.

## Shared patterns

```tsx
<div className="space-y-2">
    <h1 className="text-2xl sm:text-3xl font-light">{title}</h1>
    <p className="text-sm text-muted-foreground">{description}</p>
</div>

<Button variant="outline" size="sm">
    <Icon className="size-4" /> {label}
</Button>

<span className="text-xs text-muted-foreground">
    {year} <span className="text-border">·</span> {runtime}
</span>

<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
    {children}
</div>
```

Use `text-xs` (12px) for metadata, `text-sm` (14px) or `text-base` (16px) for body. Selected state: `ring-2 ring-primary ring-offset-1 ring-offset-background`. Input focus: `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`.

Before handing off: check light/dark contrast, keyboard and TV focus, touch minimums, accessible names and reduced motion. These are checks to perform, not claims that all existing UI already passes. Avoid redundant primitive overrides and account for frame padding before adding page padding.
