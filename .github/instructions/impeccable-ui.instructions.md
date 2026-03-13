---
applyTo: "components/**/*.tsx, app/**/*.tsx"
---
Use an Impeccable-style pass for UI changes while preserving DebridUI's design system.

Pass order:
1. Distill: remove unnecessary wrappers, nested cards, and visual noise.
2. Normalize: align spacing, typography, and icon sizing with docs/ui-minimal.md.
3. Colorize: keep muted editorial look; do not default to purple-heavy gradients.
4. Motion: add only meaningful transitions; avoid decorative animation spam.
5. Responsive: verify mobile and desktop behavior.
6. Polish: check labels, metadata formatting, hover/focus states, and empty/loading states.

Rules:
- Use existing components from components/ui.
- Keep headings light and labels uppercase with tracking as defined in docs/ui-minimal.md.
- Prefer inline metadata with separators over badge clutter.
- Use border-border/50 and bg-muted/30 style language where suitable.
- Keep implementation minimal and lint-clean.
