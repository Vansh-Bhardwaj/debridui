# Optimization Audit Report

> **Date:** February 6, 2026  
> **Scope:** Database queries, client-side fetching, caching, bundle size, UX, Cloudflare Workers free-tier limits  
> **Free-tier limits:** Neon (100 CU-hrs, 0.5 GB storage, 5 GB transfer) · Cloudflare Workers (100k req/day, 10ms CPU) · Hyperdrive (100k queries/month)

---

## 1. Database Query Optimization

### 1.1 [CRITICAL] `updateAddonOrders` — N+1 sequential queries

**File:** `lib/actions/addons.ts` lines 97–121  
**Impact:** For N addons, executes **2N individual UPDATE queries** sequentially (phase 1: set to negative, phase 2: set final). Reordering 5 addons = **10 DB queries = 10 Hyperdrive queries**.

**Recommendation:** Use a single SQL `UPDATE ... FROM (VALUES ...)` CTE or `CASE WHEN` to batch into 1–2 queries:

```sql
UPDATE addons
SET "order" = v.new_order
FROM (VALUES ($1, $2), ($3, $4), ...) AS v(id, new_order)
WHERE addons.id = v.id AND addons.user_id = $userId
```

---

### 1.2 [CRITICAL] `addAddon` — 2 queries per add

**File:** `lib/actions/addons.ts` lines 28–56  
**Impact:** One `SELECT MAX(order)` + one `INSERT`. Could be combined into a single query.

**Recommendation:** Use a subquery inside the INSERT:

```sql
INSERT INTO addons (id, user_id, name, url, enabled, "order")
VALUES ($id, $userId, $name, $url, $enabled,
  (SELECT COALESCE(MAX("order"), -1) + 1 FROM addons WHERE user_id = $userId))
RETURNING *
```

---

### 1.3 [HIGH] `syncUser` — SELECT + conditional INSERT on every session

**File:** `lib/actions/auth.ts` lines 12–31  
**Called from:** `components/auth/auth-provider.tsx` line 99 (via `useEffect` on every session)

**Impact:** Executes a `SELECT` to check if user exists + possible `INSERT` every time a session is established.

**Recommendation:** Use `INSERT ... ON CONFLICT DO NOTHING` to reduce to a single query:

```ts
await db.insert(user).values({ id, name: name || email.split("@")[0], email, image })
  .onConflictDoNothing({ target: user.id });
```

Also consider only calling `syncUser` once (on first login) by storing a flag in localStorage.

---

### 1.4 [HIGH] `removeUserAccount` — Redundant ownership SELECT

**File:** `lib/actions/user-accounts.ts` lines 82–96  
**Impact:** 2 queries (SELECT for ownership check + DELETE) when 1 suffices.

**Recommendation:** The `DELETE ... WHERE id = ? AND userId = ?` implicitly checks ownership. Check affected rows instead:

```ts
const result = await db.delete(userAccounts)
  .where(and(eq(userAccounts.id, accountId), eq(userAccounts.userId, session.user.id)));
// Check if any rows were deleted
```

---

### 1.5 [MEDIUM] `addUserAccount` — Redundant existence check

**File:** `lib/actions/user-accounts.ts` lines 41–54  
**Impact:** SELECT to check for existing + INSERT. The table already has a unique index on `(userId, apiKey, type)`.

**Recommendation:** Use `INSERT ... ON CONFLICT`:

```ts
const [account] = await db.insert(userAccounts)
  .values({ id: uuidv7(), userId, apiKey, type, name })
  .onConflictDoUpdate({
    target: [userAccounts.userId, userAccounts.apiKey, userAccounts.type],
    set: { name },
  })
  .returning();
```

---

### 1.6 [LOW] `auth.getSession()` overhead

**Files:** All files in `lib/actions/`, `app/api/progress/route.ts` (14 call sites)

**Impact:** Server-side Neon Auth uses `sessionDataTtl: 600` (10-minute cookie cache), so most calls are served from the signed cookie without hitting the auth server. This is already well-optimized.

**Recommendation:** Consider increasing `sessionDataTtl` to `1800` (30 min) since sessions are long-lived. Saves auth round-trips for power users.

---

## 2. Client-Side Data Fetching

### 2.1 [CRITICAL] File explorer polls every 3 seconds

**File:** `hooks/use-file-explorer.ts` line 23  
**Impact:** `refetchInterval: 3000` generates **20 Worker requests/minute** per active tab. A user with a tab open 8 hours = **9,600 requests/day** from this hook alone.

**Calculation:** With the 100k/day Worker limit, just **10 concurrent users** with File Explorer open would exhaust the daily quota.

**Recommendation:**
- Increase to 10–15 seconds for idle state
- Implement visibility-aware polling (stop when tab is hidden using `refetchIntervalInBackground: false`)
- **Smart polling:** Only poll at 3s when there are active/downloading torrents; increase to 30s+ when all are completed
- Example:

```ts
const hasActiveDownloads = data?.files.some(f => f.status === 'downloading');
refetchInterval: hasActiveDownloads ? 5000 : 30000
```

---

### 2.2 [HIGH] Web downloads polls every 5 seconds

**File:** `components/web-downloads/web-downloads-provider.tsx` line 41  
**Config:** `lib/clients/realdebrid.ts` line 118 and `lib/clients/torbox.ts` line 134

**Impact:** 12 requests/minute when the Links page is open.

**Recommendation:** Same as 2.1 — adaptive polling based on active download state.

---

### 2.3 [HIGH] Dashboard fires 9 parallel Trakt API calls on mount

**File:** `app/(auth)/(app)/dashboard/page.tsx` lines 108–116

**Impact:** 9 separate `useTrakt*` hooks fire simultaneously on dashboard load. Each is a Worker subrequest → external Trakt API. However, with `staleTime: 6 hours` + IDB persistence (7-day cache), repeat visits within the window are served from cache.

**Recommendation:**
- Lazy-load below-the-fold sections using Intersection Observer — only fetch "Most Watched", "Anticipated", and "Box Office" when the user scrolls near them
- This reduces initial page load from 9 to 4 API calls (Hero + Trending + Popular + Continue Watching)

---

### 2.4 [MEDIUM] `useContinueWatching` uses raw fetch, bypasses React Query

**File:** `hooks/use-progress.ts` lines 119–198

**Impact:** Uses `useEffect` + `useState` + raw `fetch()` instead of React Query. No deduplication, no IDB cache persistence, re-fetches from server on every dashboard mount.

**Recommendation:** Convert to `useQuery`:

```ts
export function useContinueWatching() {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: ["progress", "continue-watching"],
    queryFn: async () => {
      // merge local + server progress
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!session?.user,
  });
}
```

---

### 2.5 [MEDIUM] `ContinueWatchingItem` fires individual Trakt calls per item

**File:** `components/mdb/continue-watching.tsx` line 17

**Impact:** If user has 10 continue-watching items, 10 individual `useTraktMedia()` calls fire. With 24h staleTime + IDB, repeat visits are cached. First load could trigger up to 10 Trakt API calls.

**Recommendation:** These are likely cached after first visit. Low priority unless cold-start performance is a concern.

---

### 2.6 [LOW] File search `staleTime: 0`

**File:** `hooks/use-search-logic.ts` line 29

**Impact:** File search re-fetches on every mount even for the same query string.

**Recommendation:** Set `staleTime: 30_000` (30s). File lists don't change in real-time.

---

## 3. Caching Opportunities

### 3.1 [HIGH] No Cache-Control on `GET /api/progress`

**File:** `app/api/progress/route.ts` lines 7–21

**Impact:** Every dashboard load that triggers `useContinueWatching` hits Worker → Hyperdrive → Neon without any caching.

**Recommendation:** Add response headers:

```ts
return NextResponse.json({ progress }, {
  headers: {
    "Cache-Control": "private, max-age=60",
  },
});
```

---

### 3.2 [HIGH] React Query defaults — Already excellent

**File:** `lib/query-client.ts` lines 22–28 + `lib/constants.ts` lines 65–67

| Setting | Value | Assessment |
|---------|-------|------------|
| `staleTime` | 1 hour | Excellent |
| `gcTime` | 7 days | Excellent |
| IDB persistence maxAge | 7 days | Excellent |

**Note:** No changes needed. This is best-practice configuration.

---

### 3.3 [MEDIUM] Server-side caching for `getUserAccounts` and `getUserAddons`

**Files:** `lib/actions/user-accounts.ts` line 16, `lib/actions/addons.ts` line 13

**Impact:** First load always hits Neon. Client-side `staleTime: 1h` handles deduplication after first fetch.

**Recommendation:** Consider using Next.js `unstable_cache` with a per-user tag:

```ts
import { unstable_cache } from "next/cache";

const getCachedAccounts = unstable_cache(
  async (userId: string) => db.select().from(userAccounts).where(eq(userAccounts.userId, userId)),
  ["user-accounts"],
  { revalidate: 300, tags: ["user-accounts"] }
);
```

---

### 3.4 [LOW] Health endpoint DB query

**File:** `app/api/health/route.ts` lines 87–97

**Impact:** Runs `SELECT 1` on every health check. Status page defaults to 60s refresh interval.

**Recommendation:** Already reasonable. Consider adding `max-age=10` if multiple users view the status page simultaneously.

---

## 4. Bundle Size

### 4.1 [MEDIUM] `date-fns`

**File:** `package.json`  
**Size:** ~70KB minified (full), tree-shakeable to ~5-10KB for the two functions used

**Used in:** `app/(auth)/(app)/settings/page.tsx` for `formatDistanceToNow` and `format`

**Recommendation:** If these are the only two usages, replace with native `Intl.RelativeTimeFormat` + `Intl.DateTimeFormat`:

```ts
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
// replaces formatDistanceToNow

const dtf = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' });
// replaces format(date, "PPpp")
```

---

### 4.2 [MEDIUM] `@videojs/core` + `@videojs/react`

**File:** `package.json`  
**Size:** Video.js is ~200KB+ minified

**Recommendation:** Verify these are only loaded via `dynamic(() => import(...))` when the user opens the video player. Should NOT be in the initial bundle. Check with `next build` analyze.

---

### 4.3 [LOW] `fuse.js`

**File:** `package.json`  
**Size:** ~20KB minified

**Recommendation:** Ensure it's dynamically imported if only used in search. For simple cases, native filtering suffices.

---

### 4.4 [LOW] `uuid` — Server-only

**File:** `package.json`  
**Impact:** Only imported in server actions (`lib/actions/addons.ts`, `lib/actions/user-accounts.ts`). Does not affect client bundle.

**Recommendation:** No change needed. If you want to eliminate it entirely, use `crypto.randomUUID()` with a v7-compatible polyfill, but this is very low priority.

---

## 5. UX Improvements

### 5.1 [MEDIUM] Splash screen shows no loading progress

**File:** `components/auth/auth-provider.tsx` lines 153–156

**Impact:** During session check → account loading → user info loading, users see a generic splash screen with no indication of what's happening.

**Recommendation:** Pass a loading stage prop to `SplashScreen`:

```tsx
if (isSessionPending) return <SplashScreen stage="Checking session..." />;
if (!session) return <SplashScreen stage="Redirecting..." />;
if (isAccountsLoading) return <SplashScreen stage="Loading accounts..." />;
if (isLoadingUser) return <SplashScreen stage="Connecting to service..." />;
```

---

### 5.2 [MEDIUM] Dashboard animation delays don't match data availability

**File:** `app/(auth)/(app)/dashboard/page.tsx` lines 68–80

**Impact:** Content sections have staggered `animationDelay` (0ms to 400ms) that don't correlate with when data arrives. Sections may pop in at wrong times.

**Recommendation:** Remove artificial delays; instead, rely on React Query loading states to show skeletons and fade in content as data arrives.

---

### 5.3 [LOW] Settings page errors and empty states — Already good

**File:** `app/(auth)/(app)/settings/page.tsx`

All settings sections are purely client-side with Zustand persistence. No network-dependent states to worry about.

---

### 5.4 [LOW] Accounts page — Already has proper empty state

**File:** `app/(auth)/(app)/accounts/page.tsx` lines 41–45

---

### 5.5 [LOW] Addons page — Already has skeletons and empty states

**File:** `app/(auth)/(app)/addons/page.tsx`

---

## 6. Cloudflare Workers Free-Tier Budget

### 6.1 Request budget (100k/day)

| Source | Requests/min (per user) | Note |
|--------|------------------------|------|
| File explorer polling | 20/min (3s interval) | **Biggest consumer** |
| Web downloads polling | 12/min (5s interval) | Only on Links page |
| Dashboard load | 9 one-time | Cached after first load |
| API progress writes | 1/min during playback | 60s interval — fine |
| Navigation/page loads | ~2–5/min | Normal usage |

**Worst case:** 1 user with File Explorer open all day = `20 × 60 × 8 = 9,600 requests`.  
**10 users = 96,000/day** — dangerously close to the 100k limit.

**Action:** Reducing file explorer polling is the #1 priority for staying under limits.

---

### 6.2 CPU time (10ms per request)

| Operation | Estimated CPU time | Risk |
|-----------|--------------------|------|
| Static page serve | <1ms | None |
| Server action (1 DB query via Hyperdrive) | 2–4ms | Low |
| `updateAddonOrders` (10 sequential queries) | 10–20ms | **Over limit** |
| `/api/progress` POST (upsert, 1 query) | 2–3ms | None |
| `/api/health` GET (1 query + diagnostics) | 3–5ms | Low |

**Action:** Batching `updateAddonOrders` is essential to stay under the 10ms CPU limit.

---

### 6.3 Hyperdrive query budget (100k/month)

| Source | Queries/user/day | Monthly (1 user) |
|--------|-----------------|------------------|
| Page load (accounts + addons + syncUser) | ~3 | ~90 |
| Progress GET (dashboard) | ~5 | ~150 |
| Progress POST (during playback ~2hr/day) | ~120 | ~3,600 |
| Health checks (if status page open intermittently) | ~10 | ~300 |
| Addon reorder (occasional) | ~10 per reorder | ~100 |
| Account CRUD (rare) | ~2 | ~60 |
| **Total per user** | | **~4,300/month** |

**Budget:** 100k queries / 4,300 per user ≈ **~23 active users/month**.

With the optimizations in this report (batching, ON CONFLICT, fewer syncUser calls), this improves to **~30+ users**.

---

## 7. Prioritized Action Items

| Priority | Item | Savings | Effort |
|----------|------|---------|--------|
| **P0** | Reduce file explorer polling (3s → adaptive 5-30s) | ~60-80% Worker requests | Low |
| **P0** | Batch `updateAddonOrders` into 1–2 queries | 8 fewer DB queries per reorder, stay under 10ms CPU | Medium |
| **P1** | `syncUser` → `INSERT ON CONFLICT DO NOTHING` | 1 fewer query per session init | Low |
| **P1** | `addUserAccount` → `ON CONFLICT DO UPDATE` | 1 fewer query per account add | Low |
| **P1** | `removeUserAccount` → Remove ownership SELECT | 1 fewer query per removal | Low |
| **P1** | Add `Cache-Control: private, max-age=60` to `GET /api/progress` | Reduces repeated DB hits on dashboard | Low |
| **P1** | Convert `useContinueWatching` to React Query | IDB persistence, dedup, staleTime | Medium |
| **P2** | Combine `addAddon` MAX + INSERT into 1 query | 1 fewer query per addon add | Low |
| **P2** | Lazy-load below-fold dashboard sections | 5 fewer initial API calls | Medium |
| **P2** | Set `staleTime: 30s` on file search | Fewer debrid API calls | Low |
| **P2** | Add loading stage text to SplashScreen | Better perceived performance | Low |
| **P3** | Verify Video.js is dynamically imported | Bundle size | Low |
| **P3** | Replace `date-fns` with native Intl API | ~5-10KB bundle reduction | Low |
| **P3** | Increase `sessionDataTtl` to 1800s | Fewer auth round-trips | Low |

---

## Summary

The project is already well-architected with good patterns (React Query + IDB persistence, Hyperdrive connection pooling, optimistic updates, proper staleTime values). The main optimization opportunities are:

1. **Polling frequency** — The 3-second file explorer polling is the single biggest resource consumer and easiest to fix
2. **N+1 query pattern** in addon reordering — risks exceeding the 10ms CPU limit on Workers
3. **Redundant DB queries** — Several server actions do SELECT-then-INSERT when a single upsert would suffice
4. **Missing HTTP caching** — The progress API should return Cache-Control headers

Implementing just the P0 and P1 items would roughly **double the number of supported users** on the free tiers.
