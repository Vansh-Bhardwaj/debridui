/**
 * VLC progress sync — bridges VLC playback status with the app's progress tracking.
 *
 * When media plays in VLC via the bridge, this module polls VLC status and
 * writes progress to localStorage/server using the same system as browser playback.
 */

import type { ProgressKey } from "@/hooks/use-progress";
import { getVLCBridgeClient } from "@/lib/utils/media-player";
import { traktClient, TraktClient } from "@/lib/trakt";
import { queryClient } from "@/lib/query-client";
import { fetchWithTimeout, handleUnauthorizedResponse } from "@/lib/utils/error-handling";

// ── State ──────────────────────────────────────────────────────────────────

let activeSession: { key: ProgressKey; url: string; sessionId: string; seq: number } | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncTime = 0;
let lastSyncedPosition = 0;
let lastVlcState: string | null = null;
let lastKnownPosition = 0; // Track last known time for natural-end detection
let lastHistoryEmitTime = 0;
let lastHistoryProgress = 0;

const POLL_INTERVAL_PLAYING = 3000;
const POLL_INTERVAL_PAUSED = 5000;
const POLL_INTERVAL_IDLE = 7000;
const POLL_INTERVAL_HIDDEN = 10000;
const SERVER_SYNC_INTERVAL = 60_000; // 60s for DB writes
const MIN_PROGRESS_CHANGE = 5; // seconds
const HISTORY_MIN_INTERVAL = 45_000;
const HISTORY_MIN_PROGRESS_ADVANCE = 15;
const WATCHED_FALLBACK_THRESHOLD = 95;
const COMPLETE_PROGRESS_THRESHOLD = 0.95;
let lastTraktFallbackKey: string | null = null;

function getPollDelay(state?: string): number {
    if (typeof document !== "undefined" && document.hidden) return POLL_INTERVAL_HIDDEN;
    if (state === "playing") return POLL_INTERVAL_PLAYING;
    if (state === "paused") return POLL_INTERVAL_PAUSED;
    return POLL_INTERVAL_IDLE;
}

function schedulePoll(state?: string) {
    if (!activeSession) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
        pollTimer = null;
        poll();
    }, getPollDelay(state));
}

// ── localStorage helpers (same format as use-progress) ─────────────────────

function storageKey(key: ProgressKey): string {
    if (key.type === "show" && key.season !== undefined && key.episode !== undefined) {
        return `progress:${key.imdbId}:s${key.season}e${key.episode}`;
    }
    return `progress:${key.imdbId}`;
}

function writeLocal(key: ProgressKey, progressSeconds: number, durationSeconds: number) {
    try {
        localStorage.setItem(
            storageKey(key),
            JSON.stringify({ progressSeconds, durationSeconds, updatedAt: Date.now() }),
        );
    } catch {
        // quota exceeded
    }
}

async function syncToServer(
    key: ProgressKey,
    progressSeconds: number,
    durationSeconds: number,
    meta?: { eventType?: "play_progress" | "play_pause" | "play_stop" | "play_complete" | "session_end"; reason?: string }
) {
    try {
        const session = activeSession;
        const seq = session ? ++session.seq : Date.now();
        const idempotencyKey = `${key.imdbId}:${key.type}:${key.season ?? "_"}:${key.episode ?? "_"}:${session?.sessionId ?? "vlc"}:${meta?.eventType ?? "play_progress"}:${seq}`;

        const res = await fetchWithTimeout("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imdbId: key.imdbId,
                type: key.type,
                season: key.season,
                episode: key.episode,
                progressSeconds,
                durationSeconds,
                eventType: meta?.eventType ?? "play_progress",
                sessionId: session?.sessionId,
                idempotencyKey,
                player: "vlc",
                reason: meta?.reason,
            }),
        }, 10000);
        handleUnauthorizedResponse(res, { redirect: false, toastMessage: "Session expired while syncing VLC progress." });
    } catch {
        // network error — ignore, will retry
    }
}

async function syncHistoryToServer(
    key: ProgressKey,
    progressSeconds: number,
    durationSeconds: number,
    eventType: "pause" | "stop" | "complete" | "session_end",
    force = false
) {
    const minProgress = Math.min(10, durationSeconds * 0.02);
    if (progressSeconds < minProgress) return;

    const now = Date.now();
    if (!force) {
        const progressedEnough = progressSeconds - lastHistoryProgress >= HISTORY_MIN_PROGRESS_ADVANCE;
        const oldEnough = now - lastHistoryEmitTime >= HISTORY_MIN_INTERVAL;
        if (!progressedEnough && !oldEnough) return;
    }

    lastHistoryEmitTime = now;
    lastHistoryProgress = progressSeconds;

    try {
        await fetchWithTimeout("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imdbId: key.imdbId,
                type: key.type,
                season: key.season,
                episode: key.episode,
                progressSeconds: Math.round(progressSeconds),
                durationSeconds: Math.round(durationSeconds),
                eventType,
            }),
        }, 10_000);
    } catch {
        // non-critical, progress sync should continue regardless
    }
}

// ── Trakt scrobble helper ──────────────────────────────────────────────────

async function sendScrobble(key: ProgressKey, action: "start" | "pause" | "stop", progress: number) {
    if (!traktClient.getAccessToken()) return;
    const progressIdentity = `${key.imdbId}:${key.type}:${key.season ?? "_"}:${key.episode ?? "_"}`;
    const request = TraktClient.buildScrobbleRequest(
        key.imdbId, key.type, Math.min(100, Math.max(0, progress)), key.season, key.episode
    );
    try {
        if (action === "start") await traktClient.scrobbleStart(request);
        else if (action === "pause") await traktClient.scrobblePause(request);
        else await traktClient.scrobbleStop(request);

        // When scrobble stops at ≥80%, Trakt auto‑marks the episode as watched.
        // Invalidate the show’s watched‑progress cache so the UI reflects it.
        if (action === "stop" && progress >= 80 && key.type === "show") {
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
            }, 2000);
        }
    } catch {
        if (action === "stop" && progress >= WATCHED_FALLBACK_THRESHOLD && lastTraktFallbackKey !== progressIdentity) {
            try {
                if (key.type === "show" && key.season != null && key.episode != null) {
                    await traktClient.addEpisodesToHistory({ imdb: key.imdbId }, key.season, [key.episode]);
                } else if (key.type === "movie") {
                    await traktClient.addToHistory({ movies: [{ ids: { imdb: key.imdbId } }] });
                }

                lastTraktFallbackKey = progressIdentity;
                setTimeout(() => {
                    queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
                }, 2000);
            } catch {
                // non-critical
            }
        }
    }
}

// ── Polling ────────────────────────────────────────────────────────────────

async function poll() {
    if (!activeSession) return;
    let nextState: string | undefined;

    try {
        const bridge = getVLCBridgeClient();
        const res = await bridge.getStatus();
        if (!res.success || !res.data) return;

        const { time, length, state } = res.data;
        nextState = state;
        if (length <= 0) return;

        const progressPercent = (time / length) * 100;

        // Trakt scrobble on state transitions
        if (state !== lastVlcState) {
            if (state === "playing" && lastVlcState !== "playing") {
                sendScrobble(activeSession.key, "start", progressPercent);
            } else if (state === "paused" && lastVlcState === "playing") {
                sendScrobble(activeSession.key, "pause", progressPercent);
            }
            lastVlcState = state;
        }

        // Track last known position for natural-end detection
        if (state === "playing" || state === "paused") {
            lastKnownPosition = time;
        }

        // Write to localStorage on every poll
        writeLocal(activeSession.key, time, length);

        // Sync to server periodically
        const elapsed = Date.now() - lastSyncTime;
        const shouldSync =
            elapsed >= SERVER_SYNC_INTERVAL ||
            state === "paused" ||
            state === "stopped";

        if (shouldSync && Math.abs(time - lastSyncedPosition) >= MIN_PROGRESS_CHANGE) {
            syncToServer(activeSession.key, time, length, { eventType: state === "paused" ? "play_pause" : "play_progress" });
            lastSyncTime = Date.now();
            lastSyncedPosition = time;
        }

        if (state === "paused") {
            syncHistoryToServer(activeSession.key, time, length, "pause");
        }

        // Playback ended — final sync and clean up
        if (state === "stopped") {
            // VLC reports time=0 both for natural completion and manual stop.
            // Distinguish by checking whether the last known position was
            // near the end (>= 90%) — a manual stop from earlier in the
            // track will have lastKnownPosition far from the end.
            const wasNearEnd = lastKnownPosition >= length * 0.9;
            const endedNaturally = time === 0 && length > 0 && wasNearEnd;
            const finalPosition = endedNaturally ? length : Math.max(0, time || lastKnownPosition);
            const completedByProgress = length > 0 && finalPosition / length >= COMPLETE_PROGRESS_THRESHOLD;
            const treatAsComplete = endedNaturally || completedByProgress;

            if (treatAsComplete) {
                sendScrobble(activeSession.key, "stop", 100);
                syncHistoryToServer(activeSession.key, finalPosition, length, "complete", true);
            } else {
                sendScrobble(activeSession.key, "stop", progressPercent);
                syncHistoryToServer(activeSession.key, finalPosition, length, "stop", true);
            }

            syncToServer(activeSession.key, finalPosition, length, {
                eventType: treatAsComplete ? "play_complete" : "play_stop",
                reason: treatAsComplete ? (endedNaturally ? "natural_end" : "near_end_stop") : "stopped",
            });
            lastSyncTime = Date.now();
            lastSyncedPosition = finalPosition;
            stopVLCProgressSync();
            return;
        }
    } catch {
        // VLC unreachable — keep trying
    } finally {
        if (activeSession) schedulePoll(nextState);
    }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Start tracking progress for a VLC playback session. */
export function startVLCProgressSync(progressKey: ProgressKey, url: string) {
    stopVLCProgressSync();
    lastTraktFallbackKey = null;
    activeSession = {
        key: progressKey,
        url,
        sessionId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `vlc_${Date.now()}`,
        seq: 0,
    };
    lastSyncTime = 0;
    lastSyncedPosition = 0;
    lastKnownPosition = 0;
    lastVlcState = null;
    lastHistoryEmitTime = 0;
    lastHistoryProgress = 0;
    // Immediate first poll
    poll();
}

/** Stop tracking. Call when VLC stops or user navigates away. */
export function stopVLCProgressSync() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    // Final sync if we have an active session
    if (activeSession) {
        const key = activeSession.key;
        const bridge = getVLCBridgeClient();
        bridge.getStatus().then((res) => {
            if (res.success && res.data) {
                const pct = res.data.length > 0 ? (res.data.time / res.data.length) * 100 : 0;
                sendScrobble(key, "stop", pct);
                syncToServer(key, res.data.time, res.data.length, { eventType: "session_end", reason: "stop_sync" });
                syncHistoryToServer(key, res.data.time, res.data.length, "session_end", true);
            }
        }).catch(() => {});
    }
    activeSession = null;
    lastVlcState = null;
    lastKnownPosition = 0;
    lastSyncedPosition = 0;
    lastHistoryEmitTime = 0;
    lastHistoryProgress = 0;
}

/** Whether a VLC progress sync session is active. */
export function isVLCProgressSyncActive(): boolean {
    return activeSession !== null;
}

/** Get the current session's progress key. */
export function getVLCProgressSession(): ProgressKey | null {
    return activeSession?.key ?? null;
}
