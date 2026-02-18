"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { fetchWithTimeout, handleUnauthorizedResponse } from "@/lib/utils/error-handling";

/**
 * Progress key identifies a unique media item (movie or episode)
 */
export interface ProgressKey {
    imdbId: string;
    type: "movie" | "show";
    season?: number;
    episode?: number;
}

export interface ProgressData {
    progressSeconds: number;
    durationSeconds: number;
    updatedAt: number; // Unix timestamp
}

/**
 * Generate a storage key for localStorage
 */
function getStorageKey(key: ProgressKey): string {
    if (key.type === "show" && key.season !== undefined && key.episode !== undefined) {
        return `progress:${key.imdbId}:s${key.season}e${key.episode}`;
    }
    return `progress:${key.imdbId}`;
}

/**
 * Read progress from localStorage
 */
function readLocalProgress(key: ProgressKey): ProgressData | null {
    if (typeof window === "undefined") return null;
    try {
        const stored = localStorage.getItem(getStorageKey(key));
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

/**
 * Write progress to localStorage
 */
function writeLocalProgress(key: ProgressKey, data: ProgressData): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(getStorageKey(key), JSON.stringify(data));
    } catch {
        // Storage quota exceeded or other error - ignore
    }
}

/**
 * Sync progress to server (debounced, called on 60s intervals or pause/end)
 */
async function syncToServer(key: ProgressKey, data: ProgressData): Promise<void> {
    try {
        const res = await fetchWithTimeout("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imdbId: key.imdbId,
                type: key.type,
                season: key.season,
                episode: key.episode,
                progressSeconds: data.progressSeconds,
                durationSeconds: data.durationSeconds,
            }),
        });
        handleUnauthorizedResponse(res, { redirect: false, toastMessage: "Session expired while syncing progress." });
    } catch (error) {
        console.error("[progress] sync error:", error);
    }
}

// Sync interval in milliseconds (60 seconds)
const SYNC_INTERVAL = 60_000;

// Minimum progress change to trigger sync (5 seconds)
const MIN_PROGRESS_CHANGE = 5;

/**
 * Hook for tracking playback progress with optimized DB sync
 * 
 * Features:
 * - Writes to localStorage on every update (fast, no network)
 * - Syncs to DB every 60 seconds if logged in
 * - Syncs on pause and video end
 * - Returns initial progress for resume functionality
 */
export function useProgress(key: ProgressKey | null) {
    const { data: session } = authClient.useSession();
    const isLoggedIn = !!session?.user;

    const [initialProgress, setInitialProgress] = useState<number | null>(() => {
        if (!key) return null;
        const local = readLocalProgress(key);
        if (local && local.progressSeconds > 0) {
            const percent = local.durationSeconds > 0
                ? (local.progressSeconds / local.durationSeconds) * 100
                : 0;
            if (percent >= 1 && percent <= 95) {
                return local.progressSeconds;
            }
        }
        return null;
    });
    const lastSyncRef = useRef<number>(0);
    const lastProgressRef = useRef<ProgressData | null>(null);
    const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Re-compute initial progress when key identity changes
    const prevKeyRef = useRef(key);
    useEffect(() => {
        if (prevKeyRef.current === key) return;
        prevKeyRef.current = key;

        if (!key) {
            queueMicrotask(() => setInitialProgress(null));
            return;
        }
        const local = readLocalProgress(key);
        if (local && local.progressSeconds > 0) {
            const percent = local.durationSeconds > 0
                ? (local.progressSeconds / local.durationSeconds) * 100
                : 0;
            queueMicrotask(() => setInitialProgress(percent >= 1 && percent <= 95 ? local.progressSeconds : null));
        } else {
            queueMicrotask(() => setInitialProgress(null));
        }
    }, [key]);

    // Sync to server periodically
    useEffect(() => {
        if (!key || !isLoggedIn) return;

        const doSync = () => {
            if (lastProgressRef.current) {
                syncToServer(key, lastProgressRef.current);
                lastSyncRef.current = Date.now();
            }
        };

        syncIntervalRef.current = setInterval(doSync, SYNC_INTERVAL);

        return () => {
            if (syncIntervalRef.current) {
                clearInterval(syncIntervalRef.current);
            }
            // Final sync on unmount
            if (lastProgressRef.current && isLoggedIn) {
                syncToServer(key, lastProgressRef.current);
            }
        };
    }, [key, isLoggedIn]);

    // Cross-device resume: fetch server progress on mount and update if it's more recent
    useEffect(() => {
        if (!key || !isLoggedIn) return;

        const params = new URLSearchParams({ imdbId: key.imdbId });
        if (key.season != null) params.set("season", String(key.season));
        if (key.episode != null) params.set("episode", String(key.episode));

        const controller = new AbortController();
        // Timeout: don't block video start for more than 5 seconds
        const timeout = setTimeout(() => controller.abort(), 5000);

        fetch(`/api/progress?${params}`, { signal: controller.signal })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                type ServerItem = ProgressKey & { progressSeconds: number; durationSeconds: number; updatedAt: string };
                const srv = (data as { progress: ServerItem | null } | null)?.progress;
                if (!srv) return;
                const srvUpdatedAt = new Date(srv.updatedAt).getTime();
                const local = readLocalProgress(key);

                // Only apply server value if it is more recent than local
                if (!local || srvUpdatedAt > local.updatedAt) {
                    writeLocalProgress(key, {
                        progressSeconds: srv.progressSeconds,
                        durationSeconds: srv.durationSeconds,
                        updatedAt: srvUpdatedAt,
                    });
                    const percent = srv.durationSeconds > 0
                        ? (srv.progressSeconds / srv.durationSeconds) * 100
                        : 0;
                    setInitialProgress(percent >= 1 && percent <= 95 ? srv.progressSeconds : null);
                }
            })
            .catch(() => { /* aborted or network error — local data is fine */ })
            .finally(() => clearTimeout(timeout));

        return () => {
            controller.abort();
            clearTimeout(timeout);
        };
    }, [key, isLoggedIn]);

    /**
     * Update progress (called on timeupdate, throttled by caller)
     */
    const updateProgress = useCallback((progressSeconds: number, durationSeconds: number) => {
        if (!key) return;

        const data: ProgressData = {
            progressSeconds,
            durationSeconds,
            updatedAt: Date.now(),
        };

        // Always write to localStorage
        writeLocalProgress(key, data);
        lastProgressRef.current = data;
    }, [key]);

    /**
     * Force sync to server (call on pause or video end)
     */
    const forceSync = useCallback(() => {
        if (!key || !isLoggedIn || !lastProgressRef.current) return;

        // Only sync if enough time has passed since last sync
        const elapsed = Date.now() - lastSyncRef.current;
        if (elapsed >= MIN_PROGRESS_CHANGE * 1000) {
            syncToServer(key, lastProgressRef.current);
            lastSyncRef.current = Date.now();
        }
    }, [key, isLoggedIn]);

    /**
     * Mark as completed (clears from continue watching)
     */
    const markCompleted = useCallback(() => {
        if (!key) return;

        // Remove from localStorage
        try {
            localStorage.removeItem(getStorageKey(key));
        } catch { }

        // Delete from server if logged in
        if (isLoggedIn) {
            const params = new URLSearchParams({ imdbId: key.imdbId });
            if (key.season != null) params.set("season", String(key.season));
            if (key.episode != null) params.set("episode", String(key.episode));

            fetchWithTimeout(`/api/progress?${params}`, { method: "DELETE" }, 8000).catch(() => { });
        }
    }, [key, isLoggedIn]);

    return {
        initialProgress,
        updateProgress,
        forceSync,
        markCompleted,
    };
}

/**
 * Hook to fetch all progress for continue watching UI
 */
export function useContinueWatching() {
    const { data: session } = authClient.useSession();
    const isLoggedIn = !!session?.user;
    const [progress, setProgress] = useState<Array<ProgressKey & ProgressData>>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchProgress() {
            setLoading(true);

            // First, gather from localStorage
            const localItems: Array<ProgressKey & ProgressData> = [];
            if (typeof window !== "undefined") {
                try {
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (!key?.startsWith("progress:")) continue;

                        try {
                            const data = JSON.parse(localStorage.getItem(key) || "");
                            const parts = key.replace("progress:", "").split(":");
                            const imdbId = parts[0];

                            let season: number | undefined;
                            let episode: number | undefined;
                            if (parts[1]) {
                                const match = parts[1].match(/s(\d+)e(\d+)/);
                                if (match) {
                                    season = parseInt(match[1]);
                                    episode = parseInt(match[2]);
                                }
                            }

                            const percent = data.durationSeconds > 0
                                ? (data.progressSeconds / data.durationSeconds) * 100
                                : 0;
                            if (percent >= 1 && percent <= 95) {
                                localItems.push({
                                    imdbId,
                                    type: season !== undefined ? "show" : "movie",
                                    season,
                                    episode,
                                    ...data,
                                });
                            }
                        } catch { }
                    }
                } catch (e) {
                    console.warn("[continue-watching] localStorage access failed:", e);
                }
            }

            // If logged in, use server as the authoritative source
            if (isLoggedIn) {
                try {
                    const res = await fetchWithTimeout("/api/progress", { cache: "no-store" }, 10000);
                    if (handleUnauthorizedResponse(res, { redirect: false, toastMessage: "Session expired. Showing local progress only." })) {
                        throw new Error("Unauthorized");
                    }
                    if (res.ok) {
                        const { progress: serverProgress } = await res.json() as { progress: Array<ProgressKey & { progressSeconds: number; durationSeconds: number; updatedAt: string }> };

                        // Build a set of keys that exist on the server
                        const serverKeys = new Set(
                            serverProgress.map((item) =>
                                getStorageKey({ imdbId: item.imdbId, type: item.type, season: item.season, episode: item.episode })
                            )
                        );

                        // Grace period: local items newer than this may not have synced yet
                        const SERVER_SYNC_GRACE = 2 * 60 * 1000;
                        const now = Date.now();

                        const merged = new Map<string, ProgressKey & ProgressData>();

                        // Server items are authoritative
                        for (const item of serverProgress) {
                            const key: ProgressKey = { imdbId: item.imdbId, type: item.type, season: item.season, episode: item.episode };
                            const storageKey = getStorageKey(key);
                            const serverUpdatedAt = new Date(item.updatedAt).getTime();
                            const percent = item.durationSeconds > 0
                                ? (item.progressSeconds / item.durationSeconds) * 100
                                : 0;
                            if (percent >= 1 && percent <= 95) {
                                merged.set(storageKey, {
                                    ...key,
                                    progressSeconds: item.progressSeconds,
                                    durationSeconds: item.durationSeconds,
                                    updatedAt: serverUpdatedAt,
                                });
                            }
                        }

                        // Local items: include if more recent than server, OR if very recent and not yet synced
                        for (const item of localItems) {
                            const storageKey = getStorageKey(item);
                            const existing = merged.get(storageKey);

                            if (!serverKeys.has(storageKey)) {
                                if (now - item.updatedAt < SERVER_SYNC_GRACE) {
                                    // Recently watched, not yet synced to server — show it
                                    merged.set(storageKey, item);
                                } else {
                                    // Older than grace period and not on server → was deleted remotely;
                                    // clean up this device's stale localStorage entry too
                                    try { localStorage.removeItem(storageKey); } catch { }
                                }
                            } else if (existing && item.updatedAt > existing.updatedAt) {
                                // Local is more recent (e.g. actively watching right now)
                                merged.set(storageKey, item);
                            }
                        }

                        // Sort by most recently updated, then deduplicate shows to one entry each
                        const sorted = Array.from(merged.values())
                            .sort((a, b) => b.updatedAt - a.updatedAt);

                        const seen = new Set<string>();
                        const deduped = sorted.filter((item) => {
                            // For shows: keep only the most recent episode per series
                            const dedupeKey = item.type === "show" ? item.imdbId : `movie:${item.imdbId}`;
                            if (seen.has(dedupeKey)) return false;
                            seen.add(dedupeKey);
                            return true;
                        });

                        setProgress(deduped);
                        setLoading(false);
                        return;
                    }
                } catch (error) {
                    console.error("[continue-watching] fetch error:", error);
                }
            }

            // Fallback: local only (not logged in or server failed)
            const sorted = localItems.sort((a, b) => b.updatedAt - a.updatedAt);
            const seen = new Set<string>();
            const deduped = sorted.filter((item) => {
                const dedupeKey = item.type === "show" ? item.imdbId : `movie:${item.imdbId}`;
                if (seen.has(dedupeKey)) return false;
                seen.add(dedupeKey);
                return true;
            });
            setProgress(deduped);
            setLoading(false);
        }

        fetchProgress();
    }, [isLoggedIn]);

    return { progress, loading };
}
