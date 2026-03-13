# AI Agent Playbook

This guide explains when and how to use the project agents configured in `.github/agents/` and the UI instruction profile in `.github/instructions/impeccable-ui.instructions.md`.

## Available Agents

- FrontendDesign
- CodeQuality
- LearningCoach

## Quick Start

1. Pick one agent based on task intent.
2. Give file paths and a concrete goal.
3. Ask for minimal changes first.
4. Run lint after edits.

## Decision Guide

Use FrontendDesign when:
- You are creating or refining a page/component UI.
- You need responsive cleanup or visual hierarchy fixes.
- You want a design audit before shipping.

Use CodeQuality when:
- You are refactoring logic or reducing complexity.
- You suspect performance regressions or brittle effects.
- You need a strict review with severity-ranked findings.

Use LearningCoach when:
- You want to understand why a pattern is used.
- You are onboarding to stores, hooks, or streaming flow.
- You want file-based explanations and takeaways.

## Copy-Paste Prompts

### FrontendDesign
- Activate FrontendDesign. Audit `components/mdb/search-content.tsx` for hierarchy, spacing, and interaction clarity. Keep changes minimal and follow docs/ui-minimal.md.
- Activate FrontendDesign. Refine `app/(auth)/(app)/status/page.tsx` for mobile layout and metadata readability without changing behavior.
- Activate FrontendDesign. Distill complexity in `components/explorer/file-explorer.tsx` and preserve existing design language.

### CodeQuality
- Activate CodeQuality. Review `lib/stores/streaming.ts` for performance and cancellation safety. List findings by severity, then propose minimal patches.
- Activate CodeQuality. Check `hooks/use-progress.ts` for sync edge cases and unnecessary work. Keep public behavior unchanged.
- Activate CodeQuality. Audit `lib/vlc-progress.ts` polling logic for overlap/race risks and recommend smallest safe improvements.

### LearningCoach
- Activate LearningCoach. Teach me how `useStreamingStore` orchestrates source selection and playback with a simple mental model.
- Activate LearningCoach. Explain how `useProgress` handles local cache vs server sync, with pitfalls to avoid.
- Activate LearningCoach. Walk through one good Zustand selector pattern from this repo and one anti-pattern.

## UI Pass Order (Impeccable Style)

Use this pass order for UI tasks:

1. Distill
2. Normalize
3. Colorize
4. Motion
5. Responsive
6. Polish

Apply project constraints from docs/ui-minimal.md and docs/ui.md at every step.

## Team Workflow

1. Build with FrontendDesign.
2. Review with CodeQuality.
3. Capture learnings with LearningCoach.
4. Validate with `bun run lint`.

## Notes

- These agents are workflow helpers, not replacements for project rules.
- Always follow CLAUDE.md and copilot-instructions.md first.
- Prefer the smallest change that solves the problem.
