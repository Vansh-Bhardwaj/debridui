---
name: debridui-implementer
description: Ground rules for any agent implementing a task in DebridUI (the overhaul in docs/overhaul-plan.md). Read first, before editing code. Covers scope/file ownership, DB safety, lint, tests and the hand-back report.
---

# DebridUI implementer rules

You are implementing one slice of `docs/overhaul-plan.md`. A reviewer (Claude) checks your diff, runs the app and commits. Read `CLAUDE.md` and the plan section for your task first.

## Hard rules
- **Stay in your file ownership list.** Other agents edit other files in the same checkout at the same time. If you must touch a file outside your list, keep it to the smallest possible edit and call it out in your report.
- **Never** run `git commit`, `git push`, `git checkout`, `git stash` or `git reset`. Never revert changes you didn't make.
- **Never apply DB changes.** Write migrations as hand-written SQL in `drizzle/NNNN_name.sql` (next free number) and mirror them in `lib/db/schema.ts`. Never run `drizzle-kit push`/`migrate`: the local `DATABASE_URL` is the **production** database. Unique indexes are `NULLS NOT DISTINCT` (see the `lib/db/schema.ts` header).
- **Never start `next dev`/`bun run dev`.** One is already running on :3000 for the reviewer. Don't run `next build` or deploy either.
- Don't read, print or copy `.env.local` values.

## Code style (from CLAUDE.md)
- Simplest working solution. No speculative abstractions, no wrappers for one call site.
- Minimal lines; comments only for a non-obvious "why".
- Satisfy `react-hooks/exhaustive-deps` and other lint rules without `eslint-disable`.
- UI must follow `docs/ui-minimal.md` (shadcn components first, editorial tokens, square corners). Also see the `debridui-device-ui` skill.

## Checks before you hand back
1. `bun run lint` (tsc + eslint). Errors in files you own must be zero. Errors elsewhere caused by another agent's work in progress: list them, don't fix them.
2. `bun test <your test files>` for logic you added. Pure logic (detection, scoping, mapping) gets a `tests/*.test.ts` using `bun:test`.
3. Re-read your own diff (`git diff -- <your files>`) for leftovers, debug logs and dead code.

## Report format (your final message)
- **Done:** what now works, with file:line references.
- **Not done / deviations:** anything skipped or done differently from the brief, and why.
- **Touched outside ownership:** files and reasons.
- **Needs reviewer:** migrations to apply, manual UI checks to run, open questions.
- **Lint/test output:** the summary lines.

## Related skills
- `debridui-device-ui`: device classes, device frames, settings registry, TV focus, design tokens.
- `debridui-profiles`: profile scoping rules for data, caches and storage.
- `debridui-torbox`: TorBox API and gating TorBox-only features.
