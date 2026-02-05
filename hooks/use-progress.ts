"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

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
        await fetch("/api/progress", {
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

    const [initialProgress, setInitialProgress] = useState<number | null>(null);
    const lastSyncRef = useRef<number>(0);
    const lastProgressRef = useRef<ProgressData | null>(null);
    const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Load initial progress on mount
    useEffect(() => {
        if (!key) {
            setInitialProgress(null);
            return;
        }

        const local = readLocalProgress(key);
        if (local && local.progressSeconds > 0) {
            // Only resume if progress is between 1% and 95%
            const percent = local.durationSeconds > 0
                ? (local.progressSeconds / local.durationSeconds) * 100
                : 0;
            if (percent >= 1 && percent <= 95) {
                setInitialProgress(local.progressSeconds);
            }
        }
    }, [key?.imdbId, key?.type, key?.season, key?.episode]);

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
    }, [key?.imdbId, key?.type, key?.season, key?.episode, isLoggedIn]);

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
    }, [key?.imdbId, key?.type, key?.season, key?.episode]);

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
    }, [key?.imdbId, key?.type, key?.season, key?.episode, isLoggedIn]);

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
            if (key.season !== undefined) params.set("season", String(key.season));
            if (key.episode !== undefined) params.set("episode", String(key.episode));

            fetch(`/api/progress?${params}`, { method: "DELETE" }).catch(() => { });
        }
    }, [key?.imdbId, key?.type, key?.season, key?.episode, isLoggedIn]);

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

                            // Parse season/episode if present
                            let season: number | undefined;
                            let episode: number | undefined;
                            if (parts[1]) {
                                const match = parts[1].match(/s(\d+)e(\d+)/);
                                if (match) {
                                    season = parseInt(match[1]);
                                    episode = parseInt(match[2]);
                                }
                            }

                            // Filter to items between 1% and 95% progress
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

            // If logged in, also fetch from server and merge
            if (isLoggedIn) {
                try {
                    const res = await fetch("/api/progress");
                    if (res.ok) {
                        const { progress: serverProgress } = await res.json() as { progress: Array<ProgressKey & ProgressData> };

                        // Merge: prefer most recent between local and server
                        const merged = new Map<string, ProgressKey & ProgressData>();

                        for (const item of localItems) {
                            const key = getStorageKey(item);
                            merged.set(key, item);
                        }

                        for (const item of serverProgress) {
                            const progressKey: ProgressKey = {
                                imdbId: item.imdbId,
                                type: item.type,
                                season: item.season,
                                episode: item.episode,
                            };
                            const key = getStorageKey(progressKey);
                            const existing = merged.get(key);

                            const serverUpdatedAt = new Date(item.updatedAt).getTime();
                            if (!existing || serverUpdatedAt > existing.updatedAt) {
                                // Filter to items between 1% and 95%
                                const percent = item.durationSeconds > 0
                                    ? (item.progressSeconds / item.durationSeconds) * 100
                                    : 0;
                                if (percent >= 1 && percent <= 95) {
                                    merged.set(key, {
                                        ...progressKey,
                                        progressSeconds: item.progressSeconds,
                                        durationSeconds: item.durationSeconds,
                                        updatedAt: serverUpdatedAt,
                                    });
                                }
                            }
                        }

                        // Sort by most recently updated
                        const sorted = Array.from(merged.values())
                            .sort((a, b) => b.updatedAt - a.updatedAt);

                        setProgress(sorted);
                        setLoading(false);
                        return;
                    }
                } catch (error) {
                    console.error("[continue-watching] fetch error:", error);
                }
            }

            // Fallback to local only
            localItems.sort((a, b) => b.updatedAt - a.updatedAt);
            setProgress(localItems);
            setLoading(false);
        }

        fetchProgress();
    }, [isLoggedIn]);

    return { progress, loading };
}
