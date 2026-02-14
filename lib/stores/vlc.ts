/**
 * Global VLC Bridge store — single source of truth for VLC connection + playback state.
 *
 * Auto-detects the extension when mediaPlayer is VLC, polls status, and provides
 * controls that any component can use (mini-player, status page, etc.).
 */

import { create } from "zustand";
import { VLCBridgeClient, type VLCStatus } from "@/lib/vlc-bridge";
import { MediaPlayer } from "@/lib/types";
import { useSettingsStore } from "./settings";

// ── Types ──────────────────────────────────────────────────────────────────

interface VLCTrack {
    id: number;
    name: string;
}

interface VLCState {
    // Connection
    extensionDetected: boolean;
    vlcConnected: boolean;
    detecting: boolean;

    // Playback
    status: VLCStatus | null;
    nowPlaying: string | null;
    audioTracks: VLCTrack[];
    subtitleTracks: VLCTrack[];

    // Actions
    detect: () => Promise<boolean>;
    poll: () => Promise<void>;
    startPolling: () => void;
    stopPolling: () => void;

    // Controls
    togglePause: () => Promise<void>;
    stop: () => Promise<void>;
    seek: (val: number | string) => Promise<void>;
    setVolume: (val: number | string) => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    setAudioTrack: (id: number) => Promise<void>;
    setSubtitleTrack: (id: number) => Promise<void>;
    fullscreen: () => Promise<void>;
}

// ── Singleton client ───────────────────────────────────────────────────────

let client: VLCBridgeClient | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let failCount = 0;

// Adaptive intervals: fast when playing, slow when idle/disconnected
const POLL_PLAYING_MS = 1000;
const POLL_PAUSED_MS = 3000;
const POLL_IDLE_MS = 5000;
const POLL_BACKOFF_MAX_MS = 10000;

function getClient(): VLCBridgeClient {
    if (!client) {
        client = new VLCBridgeClient();
    }
    return client;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseNowPlaying(status: VLCStatus): string | null {
    const meta = status.information?.category?.meta;
    if (!meta) return null;
    const filename = meta.filename || meta.title || meta.TITLE;
    if (!filename) return null;
    // Clean up URL-encoded filenames
    try {
        return decodeURIComponent(filename);
    } catch {
        return filename;
    }
}

function parseCodecShort(codec: string): string | null {
    if (/a52|ac-?3/i.test(codec)) return "AC3";
    if (/e-?ac-?3|eac3/i.test(codec)) return "EAC3";
    if (/dts/i.test(codec)) return "DTS";
    if (/aac|mp4a/i.test(codec)) return "AAC";
    if (/opus/i.test(codec)) return "Opus";
    if (/flac/i.test(codec)) return "FLAC";
    if (/truehd/i.test(codec)) return "TrueHD";
    if (/pcm|lpcm/i.test(codec)) return "PCM";
    return null;
}

function parseTracks(status: VLCStatus, type: "Audio" | "Subtitle"): VLCTrack[] {
    const category = status.information?.category;
    if (!category) return [];
    const tracks: VLCTrack[] = [];
    let index = 0;
    for (const [key, val] of Object.entries(category)) {
        if (!key.startsWith("Stream ") || !val || val.Type !== type) continue;
        const idMatch = key.match(/Stream (\d+)/);
        if (!idMatch) continue;
        const id = Number(idMatch[1]);
        index++;

        const lang = val.Language ? String(val.Language) : null;
        const desc = val.Description ? String(val.Description) : null;

        let name: string;
        if (type === "Audio") {
            // Audio: "Track N - [Language] (AC3 5.1)" or "Track N (AC3 5.1)"
            const codec = val.Codec ? parseCodecShort(String(val.Codec)) : null;
            const channels = val.Channels ? String(val.Channels) : null;
            const codecPart = [codec, channels].filter(Boolean).join(" ");
            const label = desc || (lang ? `[${lang}]` : null);
            name = label
                ? `Track ${index} - ${label}${codecPart ? ` (${codecPart})` : ""}`
                : `Track ${index}${codecPart ? ` (${codecPart})` : ""}`;
        } else {
            // Subtitle: match VLC style — "Track N - [Language]" or "Forced - [Language]"
            const label = desc ? `${desc}${lang ? ` - [${lang}]` : ""}` : lang ? `Track ${index} - [${lang}]` : `Track ${index}`;
            name = label;
        }

        tracks.push({ id, name });
    }
    return tracks;
}

function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    const state = useVLCStore.getState();

    let delay: number;
    if (failCount > 0) {
        // Exponential backoff on failures: 5s, 7.5s, 10s cap
        delay = Math.min(POLL_IDLE_MS * Math.pow(1.5, failCount - 1), POLL_BACKOFF_MAX_MS);
    } else if (state.status?.state === "playing") {
        delay = POLL_PLAYING_MS;
    } else if (state.status?.state === "paused") {
        delay = POLL_PAUSED_MS;
    } else {
        delay = POLL_IDLE_MS;
    }

    pollTimer = setTimeout(() => {
        pollTimer = null;
        useVLCStore.getState().poll();
    }, delay);
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useVLCStore = create<VLCState>()((set, get) => ({
    extensionDetected: false,
    vlcConnected: false,
    detecting: false,
    status: null,
    nowPlaying: null,
    audioTracks: [],
    subtitleTracks: [],

    detect: async () => {
        set({ detecting: true });
        try {
            const found = await getClient().detect();
            set({ extensionDetected: found, detecting: false });
            if (found) {
                // Immediately check VLC connection
                get().poll();
            }
            return found;
        } catch {
            set({ extensionDetected: false, detecting: false });
            return false;
        }
    },

    poll: async () => {
        if (!get().extensionDetected) return;
        try {
            const res = await getClient().getStatus();
            if (res.success && res.data) {
                const status = res.data as VLCStatus;
                failCount = 0;
                const subtitleTracks = parseTracks(status, "Subtitle");
                const prev = get();
                set({
                    vlcConnected: true,
                    status,
                    nowPlaying: parseNowPlaying(status),
                    audioTracks: parseTracks(status, "Audio"),
                    subtitleTracks,
                });

                // Auto-select subtitle track matching user's preferred language (once per media)
                if (subtitleTracks.length > 0 && prev.subtitleTracks.length === 0) {
                    const lang = useSettingsStore.getState().settings.playback.subtitleLanguage;
                    if (lang) {
                        const match = subtitleTracks.find((t) =>
                            t.name.toLowerCase().includes(lang.toLowerCase())
                        );
                        if (match) {
                            getClient().setSubtitleTrack(match.id).catch(() => {});
                        }
                    }
                }
            } else {
                failCount++;
                set({ vlcConnected: false, status: null, nowPlaying: null });
            }
        } catch {
            failCount++;
            set({ vlcConnected: false, status: null, nowPlaying: null });
        }
        // Schedule next poll adaptively
        schedulePoll();
    },

    startPolling: () => {
        if (pollTimer) return;
        failCount = 0;
        get().poll();
    },

    stopPolling: () => {
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    },

    // ── Controls ─────────────────────────────────────────────────────────

    togglePause: async () => {
        try { await getClient().togglePause(); } catch { /* noop */ }
    },

    stop: async () => {
        try {
            await getClient().stop();
            set({ status: null, nowPlaying: null });
        } catch { /* noop */ }
    },

    seek: async (val) => {
        try { await getClient().seek(val); } catch { /* noop */ }
    },

    setVolume: async (val) => {
        try { await getClient().setVolume(val); } catch { /* noop */ }
    },

    next: async () => {
        try { await getClient().next(); } catch { /* noop */ }
    },

    previous: async () => {
        try { await getClient().previous(); } catch { /* noop */ }
    },

    setAudioTrack: async (id) => {
        try { await getClient().setAudioTrack(id); } catch { /* noop */ }
    },

    setSubtitleTrack: async (id) => {
        try { await getClient().setSubtitleTrack(id); } catch { /* noop */ }
    },

    fullscreen: async () => {
        try { await getClient().fullscreen(); } catch { /* noop */ }
    },
}));

// ── Auto-detect when player setting changes ────────────────────────────────

let settingsUnsubscribe: (() => void) | null = null;
let lastPlayer: MediaPlayer | null = null;

export function initVLCAutoDetect() {
    if (settingsUnsubscribe) return;

    const check = () => {
        const player = useSettingsStore.getState().get("mediaPlayer");
        if (player === lastPlayer) return;
        lastPlayer = player;

        const store = useVLCStore.getState();

        if (player === MediaPlayer.VLC) {
            if (!store.extensionDetected && !store.detecting) {
                store.detect().then((found) => {
                    if (found) useVLCStore.getState().startPolling();
                });
            } else if (store.extensionDetected) {
                store.startPolling();
            }
        } else {
            store.stopPolling();
        }
    };

    // Initial check
    check();

    // Watch for settings changes
    settingsUnsubscribe = useSettingsStore.subscribe(check);

    // Force re-check after delay to catch persist rehydration
    setTimeout(() => { lastPlayer = null; check(); }, 500);

    // Listen for late extension injection (VLC extension loaded after page)
    if (typeof window !== "undefined") {
        window.addEventListener("vlc-bridge-available", () => {
            const store = useVLCStore.getState();
            if (!store.extensionDetected && !store.detecting) {
                store.detect().then((found) => {
                    if (found) useVLCStore.getState().startPolling();
                });
            }
        });

        // Periodic re-detection when VLC is selected but extension not found
        // Checks every 5s, stops after 5 minutes (60 retries) to avoid indefinite polling.
        // The vlc-bridge-available event listener above will still catch late extension loads.
        let retryCount = 0;
        const MAX_RETRIES = 60; // 5 minutes at 5s intervals
        const retryDetect = () => {
            if (retryCount >= MAX_RETRIES) return;
            retryCount++;
            const player = useSettingsStore.getState().get("mediaPlayer");
            const store = useVLCStore.getState();
            if (player === MediaPlayer.VLC && !store.extensionDetected && !store.detecting) {
                store.detect().then((found) => {
                    if (found) {
                        useVLCStore.getState().startPolling();
                    } else {
                        setTimeout(retryDetect, 5000);
                    }
                });
            } else if (player === MediaPlayer.VLC && !store.vlcConnected) {
                // Extension detected but VLC not running — keep retrying
                setTimeout(retryDetect, 5000);
            }
        };
        // Reset retry count when settings change (player toggled)
        useSettingsStore.subscribe(() => { retryCount = 0; });
        setTimeout(retryDetect, 3000);
    }
}
