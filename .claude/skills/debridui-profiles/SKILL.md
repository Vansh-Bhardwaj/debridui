---
name: debridui-profiles
description: Rules for profile-scoped data in DebridUI (Netflix-style family profiles). Covers what is shared vs per-profile, getActor(), migrations, React Query keys, localStorage and Trakt. Use when touching auth, DB, server actions, API routes, progress/history or Trakt.
---

# Profiles in DebridUI

## What is shared vs per profile
- **Shared (account-level, keyed by `user_id`):**
  - debrid accounts (`user_accounts`)
  - addons (`addons`)
  - the TMDB key
  - device sync (one Durable Object per user)
- **Per profile (keyed by `profile_id`):**
  - `user_progress`, `watch_history`, `hidden_continue_watching`, `watch_events`
  - the Trakt tokens and per-person preferences, in `profile_settings`
- There are no PINs and no kid profiles.

## Server identity
- Always use `getActor()` (`lib/auth/actor.ts`) in server actions and API routes. Never call `auth.getSession()` directly.
- It returns `{ userId, profileId }`, or throws/returns 401.
- `profileId` comes from the signed httpOnly cookie `dui-profile`. It must be checked to belong to `userId`, with a short in-memory cache (Cloudflare CPU limits; see `tests/cf-cpu-limits.test.ts`). If the cookie is missing or invalid, use the user's oldest profile.
- Account-level code only uses `userId`. Per-profile code filters on **both** `userId` and `profileId`.

## Migrations
- Hand-written SQL in `drizzle/`, mirrored in `lib/db/schema.ts`. Never `drizzle-kit push`.
- Steps:
  1. Create `profiles` and `profile_settings`.
  2. Insert one "Default" profile per existing user.
  3. Add `profile_id` and backfill it.
  4. Set it NOT NULL.
  5. Rebuild the unique indexes as `(user_id, profile_id, …) NULLS NOT DISTINCT`.
  6. Move the Trakt keys from `user_settings.settings` to `profile_settings`.
- The migration is applied by the reviewer **at deploy time**, because the running prod code relies on the old indexes. Code must not assume it has been applied during local review on the prod DB.

## Client
- The active profile comes from `useProfile()`.
- Every React Query key for per-profile data includes `profileId`: `["continue-watching", profileId]`, `["trakt", profileId, …]`, `["user-settings", profileId]`, `["watched-ids", "v2", profileId]`.
- When the profile switches:
  - reset `traktClient` (token and refresh handler)
  - clear per-profile queries
  - reload the per-profile preferences
- localStorage:
  - per-profile keys are namespaced: `progress:{profileId}:{imdb}…` and the persisted preferences store name.
  - device-only keys stay global: volume, device id, `selected-account-id`.
- Trakt OAuth: the `state` carries the profile id, and the callback writes the tokens to that profile's `profile_settings`.
