import type { AddonSource } from "@/lib/addons/types";

/**
 * Per-device memory of sources that failed (error, stub file, unplayable) so
 * they rank last for a while instead of being auto-picked again. Stored in
 * localStorage: zero server cost, nothing leaves the device.
 */

const STORAGE_KEY = "debridui-failed-sources-v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;

type FailureMap = Record<string, { ts: number; reason: string }>;

let memory: FailureMap | null = null;

function load(): FailureMap {
    if (memory) return memory;
    try {
        memory = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as FailureMap;
    } catch {
        memory = {};
    }
    return memory;
}

function save(map: FailureMap) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch { /* storage full / disabled */ }
}

/** Stable identity: info hash + file index survives addon URL changes. */
export function sourceFingerprint(source: Pick<AddonSource, "magnet" | "fileIdx" | "url">): string | null {
    const hash = source.magnet?.match(/btih:([a-f0-9]{40})/i)?.[1]?.toLowerCase();
    if (hash) return `h:${hash}:${source.fileIdx ?? ""}`;
    return source.url ? `u:${source.url}` : null;
}

export function markSourceFailed(source: AddonSource, reason: string): void {
    const id = sourceFingerprint(source);
    if (!id) return;
    const map = load();
    // Keep the most specific reason (e.g. "stub") when a generic failure follows.
    map[id] = { ts: Date.now(), reason: map[id]?.reason ?? reason };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => map[a].ts - map[b].ts).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete map[k]);
    }
    save(map);
}

export function getSourceFailure(source: AddonSource): string | null {
    const id = sourceFingerprint(source);
    if (!id) return null;
    const entry = load()[id];
    if (!entry) return null;
    if (Date.now() - entry.ts > TTL_MS) {
        delete load()[id];
        save(load());
        return null;
    }
    return entry.reason;
}

export function clearFailedSources(): void {
    memory = {};
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}

// Pre-release theatrical captures. Matched on word boundaries so titles like
// "Camden" or "TSUNAMI" don't trip it.
const CAM_PATTERN = /\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr)\b/i;

export function isCamRelease(source: Pick<AddonSource, "title" | "description">): boolean {
    return CAM_PATTERN.test(`${source.title ?? ""} ${source.description ?? ""}`);
}

/** Debrid "file unavailable" placeholders are short clips; real content isn't. */
export function isLikelyStub(durationSeconds: number): boolean {
    return durationSeconds > 0 && durationSeconds < 150;
}
