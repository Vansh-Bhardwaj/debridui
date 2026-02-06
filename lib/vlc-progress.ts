/**
 * VLC progress sync — bridges VLC playback status with the app's progress tracking.
 *
 * When media plays in VLC via the bridge, this module polls VLC status and
 * writes progress to localStorage/server using the same system as browser playback.
 */

import type { ProgressKey } from "@/hooks/use-progress";
import { getVLCBridgeClient } from "@/lib/utils/media-player";

// ── State ──────────────────────────────────────────────────────────────────

let activeSession: { key: ProgressKey; url: string } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncTime = 0;

const POLL_INTERVAL = 3000; // 3s for responsive progress bar
const SERVER_SYNC_INTERVAL = 60_000; // 60s for DB writes
const MIN_PROGRESS_CHANGE = 5; // seconds

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

async function syncToServer(key: ProgressKey, progressSeconds: number, durationSeconds: number) {
    try {
        await fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imdbId: key.imdbId,
                type: key.type,
                season: key.season,
                episode: key.episode,
                progressSeconds,
                durationSeconds,
            }),
        });
    } catch {
        // network error — ignore, will retry
    }
}

// ── Polling ────────────────────────────────────────────────────────────────

async function poll() {
    if (!activeSession) return;

    try {
        const bridge = getVLCBridgeClient();
        const res = await bridge.getStatus();
        if (!res.success || !res.data) return;

        const { time, length, state } = res.data;
        if (length <= 0) return;

        // Write to localStorage on every poll
        writeLocal(activeSession.key, time, length);

        // Sync to server periodically
        const elapsed = Date.now() - lastSyncTime;
        const shouldSync =
            elapsed >= SERVER_SYNC_INTERVAL ||
            state === "paused" ||
            state === "stopped";

        if (shouldSync && Math.abs(time - (lastSyncTime ? time : 0)) >= MIN_PROGRESS_CHANGE) {
            syncToServer(activeSession.key, time, length);
            lastSyncTime = Date.now();
        }

        // Playback ended — final sync and clean up
        if (state === "stopped" && time === 0 && length > 0) {
            syncToServer(activeSession.key, length, length);
            stopVLCProgressSync();
        }
    } catch {
        // VLC unreachable — keep trying
    }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Start tracking progress for a VLC playback session. */
export function startVLCProgressSync(progressKey: ProgressKey, url: string) {
    stopVLCProgressSync();
    activeSession = { key: progressKey, url };
    lastSyncTime = 0;
    pollTimer = setInterval(poll, POLL_INTERVAL);
    // Immediate first poll
    poll();
}

/** Stop tracking. Call when VLC stops or user navigates away. */
export function stopVLCProgressSync() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    // Final sync if we have an active session
    if (activeSession) {
        const bridge = getVLCBridgeClient();
        bridge.getStatus().then((res) => {
            if (res.success && res.data && activeSession) {
                syncToServer(activeSession.key, res.data.time, res.data.length);
            }
        }).catch(() => {});
    }
    activeSession = null;
}

/** Whether a VLC progress sync session is active. */
export function isVLCProgressSyncActive(): boolean {
    return activeSession !== null;
}

/** Get the current session's progress key. */
export function getVLCProgressSession(): ProgressKey | null {
    return activeSession?.key ?? null;
}
