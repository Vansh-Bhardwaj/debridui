/**
 * Device Sync Store — cross-device playback control like Spotify Connect.
 *
 * Three sync layers (unified into one event stream):
 *   1. BroadcastChannel — same browser tabs (instant, free)
 *   2. WebSocket via Durable Object — cross-device (<100ms, free tier)
 *   3. (Future) Local network via Tauri mDNS
 *
 * Integrates with:
 *   - useStreamingStore (source playback)
 *   - usePreviewStore (browser video player)
 *   - useVLCStore (VLC remote control)
 */

import { create } from "zustand";
import { DeviceSyncClient, type ConnectionStatus } from "@/lib/device-sync/client";
import { DeviceSyncBroadcast } from "@/lib/device-sync/broadcast";
import type {
    DeviceInfo,
    NowPlayingInfo,
    ServerMessage,
    TransferPayload,
    RemoteAction,
    BrowseRequest,
    BrowseResponse,
    DeviceNotification,
    QueueItem,
} from "@/lib/device-sync/protocol";
import { detectDevice, getDeviceId } from "@/lib/device-sync/protocol";
import { useSettingsStore } from "@/lib/stores/settings";
import { toast } from "sonner";
import { fetchWithTimeout, handleUnauthorizedResponse } from "@/lib/utils/error-handling";

// ── Types ──────────────────────────────────────────────────────────────────

interface DeviceSyncState {
    // State
    thisDevice: Pick<DeviceInfo, "id" | "name" | "deviceType" | "browser">;
    devices: DeviceInfo[];
    connectionStatus: ConnectionStatus;
    enabled: boolean;
    /** The device ID currently selected as playback target (null = this device) */
    activeTarget: string | null;
    /** When this device is being controlled by another device */
    controlledBy: { id: string; name: string } | null;
    /** Remote browse results (controller receives these from the target) */
    browseResults: Map<string, BrowseResponse>;
    /** Shared playback queue (persisted in DO SQLite) */
    queue: QueueItem[];
    /** Title of content currently being transferred to remote device */
    transferPending: string | null;
    /** Pending browse request callbacks */
    _browseCallbacks: Map<string, (response: BrowseResponse) => void>;

    // Actions
    connect: () => Promise<void>;
    disconnect: () => void;
    sendCommand: (targetId: string, action: RemoteAction, payload?: Record<string, unknown>) => void;
    transferPlayback: (targetId: string, playback: TransferPayload) => void;
    reportNowPlaying: (state: NowPlayingInfo | null) => void;
    setEnabled: (enabled: boolean) => void;
    /** Select a device as the playback target. null = play locally on this device. */
    setActiveTarget: (deviceId: string | null) => void;
    /** Attempt to play on the active target. Returns true if intercepted (remote), false if should play locally. */
    playOnTarget: (payload: TransferPayload) => boolean;

    // Browse
    /** Request file list or search from a target device. Returns a promise with the response. */
    browseDevice: (targetId: string, request: Omit<BrowseRequest, "requestId">) => Promise<BrowseResponse>;
    /** (Internal) Respond to a browse request from a controller (called on the target device) */
    _respondToBrowse: (fromId: string, request: BrowseRequest) => void;
    /** (Internal) Send browse response back via WebSocket */
    _sendBrowseResponse: (targetId: string, response: BrowseResponse) => void;

    // Notifications
    /** Send a notification to all connected devices */
    sendNotification: (notification: Omit<DeviceNotification, "id">) => void;

    // Queue
    /** Add an item to the shared playback queue */
    queueAdd: (item: Omit<QueueItem, "id" | "addedAt">) => void;
    /** Remove an item from the queue */
    queueRemove: (itemId: string) => void;
    /** Clear the entire queue */
    queueClear: () => void;
    /** Reorder the queue */
    queueReorder: (itemIds: string[]) => void;
    /** Get the next item from the queue (removes it) */
    queuePlayNext: () => QueueItem | null;
    /** Request the current queue from the server */
    queueRefresh: () => void;

    // Internal
    _handleMessage: (msg: ServerMessage) => void;
}

// ── Singleton Clients ──────────────────────────────────────────────────────

let wsClient: DeviceSyncClient | null = null;
let broadcast: DeviceSyncBroadcast | null = null;
let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenRequestPromise: Promise<string | null> | null = null;
let transferPendingTimer: ReturnType<typeof setTimeout> | null = null;

const SYNC_WORKER_URL = process.env.NEXT_PUBLIC_DEVICE_SYNC_URL ?? "";

async function fetchToken(): Promise<string | null> {
    // Return cached token if still valid (refresh 1hr before expiry)
    if (tokenCache && tokenCache.expiresAt > Date.now() + 3600_000) {
        return tokenCache.token;
    }

    if (tokenRequestPromise) {
        return tokenRequestPromise;
    }

    tokenRequestPromise = (async () => {
        try {
            const res = await fetchWithTimeout("/api/remote/token", undefined, 8000);
            if (handleUnauthorizedResponse(res, { redirect: false, toastMessage: "Session expired. Device sync paused." })) {
                return null;
            }
            if (!res.ok) return null;
            const data = (await res.json()) as { token: string };
            // Token is valid 24hr, cache it
            tokenCache = { token: data.token, expiresAt: Date.now() + 23 * 3600_000 };
            return data.token;
        } catch {
            return null;
        } finally {
            tokenRequestPromise = null;
        }
    })();

    return tokenRequestPromise;
}

function safeVideoPlay(video: HTMLVideoElement) {
    const result = video.play();
    if (result && typeof result.catch === "function") {
        result.catch(() => {
            // Ignore autoplay/user-gesture rejections for remote commands.
        });
    }
}

// ── Command Handler (processes incoming remote commands) ───────────────────

function handleRemoteCommand(action: string, payload?: Record<string, unknown>) {
    // Lazy import to avoid circular dependency issues
    switch (action) {
        case "play":
        case "pause":
        case "toggle-pause": {
            // Try browser player first, then VLC
            const video = document.querySelector("video");
            if (video) {
                if (action === "play") safeVideoPlay(video);
                else if (action === "pause") video.pause();
                else if (video.paused) safeVideoPlay(video); else video.pause();
            } else {
                // VLC control — import dynamically
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    useVLCStore.getState().togglePause();
                });
            }
            break;
        }
        case "seek": {
            const position = payload?.position as number | undefined;
            if (position === undefined) break;
            const video = document.querySelector("video");
            if (video) {
                video.currentTime = position;
            } else {
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    useVLCStore.getState().seek(position);
                });
            }
            break;
        }
        case "volume": {
            const level = payload?.level as number | undefined;
            if (level === undefined) break;
            const video = document.querySelector("video");
            if (video) {
                video.volume = Math.max(0, Math.min(1, level));
            } else {
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    // VLC volume is 0-512 (256 = 100%)
                    useVLCStore.getState().setVolume(Math.round(level * 256));
                });
            }
            break;
        }
        case "stop": {
            const video = document.querySelector("video");
            if (video) {
                video.pause();
                video.currentTime = 0;
                import("@/lib/stores/preview").then(({ usePreviewStore }) => {
                    usePreviewStore.getState().closePreview();
                });
            } else {
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    useVLCStore.getState().stop();
                });
            }
            break;
        }
        case "next":
        case "previous": {
            // Episode navigation handled by streaming store
            // This requires addons to be available — emit an event for the component to handle
            window.dispatchEvent(
                new CustomEvent("device-sync-navigate", { detail: { direction: action } })
            );
            break;
        }
        case "set-audio-track": {
            const trackId = payload?.trackId as number | undefined;
            if (trackId === undefined) break;
            // Try browser video first (Safari supports HTMLMediaElement.audioTracks)
            const audioVideo = document.querySelector("video");
            const audioTrackList = (audioVideo as unknown as { audioTracks?: { length: number; [index: number]: { enabled: boolean } } } | null)?.audioTracks;
            if (audioTrackList?.length) {
                for (let i = 0; i < audioTrackList.length; i++) {
                    audioTrackList[i].enabled = i === trackId;
                }
                break;
            }
            // Fallback to VLC
            import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                useVLCStore.getState().setAudioTrack(trackId);
            });
            break;
        }
        case "set-subtitle-track": {
            const trackId = payload?.trackId as number | undefined;
            if (trackId === undefined) break;
            const video = document.querySelector("video");
            if (video) {
                // The video preview uses a custom subtitle overlay (not native textTracks).
                // Dispatch a custom event so the preview component can update its local state.
                window.dispatchEvent(
                    new CustomEvent("device-sync-subtitle", { detail: { trackId } })
                );
            } else {
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    useVLCStore.getState().setSubtitleTrack(trackId);
                });
            }
            break;
        }
        case "fullscreen": {
            const video = document.querySelector("video");
            if (video) {
                // Dispatch a custom event so the video preview component can handle fullscreen
                // within its own user-gesture context (direct requestFullscreen from a
                // WebSocket handler may be blocked by browsers)
                window.dispatchEvent(new CustomEvent("device-sync-fullscreen"));
            } else {
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    useVLCStore.getState().fullscreen();
                });
            }
            break;
        }
        case "play-episode": {
            // Remote device is requesting we play a specific episode
            const imdbId = payload?.imdbId as string | undefined;
            const season = payload?.season as number | undefined;
            const episode = payload?.episode as number | undefined;
            const title = payload?.title as string | undefined;
            if (!imdbId || season == null || episode == null) break;

            window.dispatchEvent(
                new CustomEvent("device-sync-play-episode", {
                    detail: { imdbId, season, episode, title: title ?? "" },
                })
            );
            break;
        }
        case "play-media": {
            // Remote device is requesting we play a movie or show episode
            const imdbId = payload?.imdbId as string | undefined;
            const type = payload?.type as "movie" | "show" | undefined;
            const title = payload?.title as string | undefined;
            if (!imdbId || !type) break;

            if (type === "movie") {
                window.dispatchEvent(
                    new CustomEvent("device-sync-play-media", {
                        detail: { imdbId, type, title: title ?? "" },
                    })
                );
            } else {
                const season = payload?.season as number | undefined;
                const episode = payload?.episode as number | undefined;
                if (season == null || episode == null) break;
                window.dispatchEvent(
                    new CustomEvent("device-sync-play-media", {
                        detail: { imdbId, type, title: title ?? "", season, episode },
                    })
                );
            }
            break;
        }
        case "play-source": {
            // Remote device is requesting we play a specific source by index
            const sourceIndex = payload?.index as number | undefined;
            if (sourceIndex == null) break;

            window.dispatchEvent(
                new CustomEvent("device-sync-play-source", {
                    detail: { index: sourceIndex },
                })
            );
            break;
        }
    }
}

function handleTransfer(playback: TransferPayload, fromName: string) {
    toast.info(`Playing from ${fromName}`, {
        description: playback.title,
        duration: 3000,
    });

    // Immediately report a "loading" now-playing state so the controller
    // clears its "Loading on device..." pending state right away,
    // even before the video element loads (which can be delayed by subtitle preloading).
    useDeviceSyncStore.getState().reportNowPlaying({
        title: playback.title,
        imdbId: playback.imdbId,
        type: playback.mediaType,
        season: playback.season,
        episode: playback.episode,
        progress: 0,
        duration: 0,
        paused: true,
    });

    const progressKey = playback.imdbId
        ? {
              imdbId: playback.imdbId,
              type: (playback.mediaType ?? "movie") as "movie" | "show",
              season: playback.season,
              episode: playback.episode,
          }
        : undefined;

    // Set episode context so next/previous navigation works on the target device
    if (playback.imdbId && playback.mediaType === "show" && playback.season != null && playback.episode != null) {
        import("@/lib/stores/streaming").then(({ useStreamingStore }) => {
            useStreamingStore.getState().setEpisodeContext({
                imdbId: playback.imdbId!,
                title: playback.title,
                season: playback.season!,
                episode: playback.episode!,
            });
        });
    }

    // Respect the target device's media player preference
    const mediaPlayer = useSettingsStore.getState().get("mediaPlayer");

    import("@/lib/types").then(({ MediaPlayer, FileType }) => {
        if (mediaPlayer !== MediaPlayer.BROWSER) {
            // External player (VLC, IINA, etc.) — use openInPlayer which handles
            // VLC bridge, progress sync, subtitle proxying, and resume
            import("@/lib/utils/media-player").then(({ openInPlayer }) => {
                openInPlayer({
                    url: playback.url,
                    fileName: playback.title,
                    player: mediaPlayer,
                    subtitles: playback.subtitles?.map((s) => s.url),
                    progressKey,
                });
            });
        } else {
            // Browser preview — existing behavior
            import("@/lib/stores/preview").then(({ usePreviewStore }) => {
                usePreviewStore.getState().openSinglePreview({
                    url: playback.url,
                    title: playback.title,
                    fileType: FileType.VIDEO,
                    subtitles: playback.subtitles?.map((s) => ({
                        url: s.url,
                        lang: s.lang,
                        id: s.url,
                        name: s.name,
                    })),
                    progressKey,
                });
            });
        }
    });
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useDeviceSyncStore = create<DeviceSyncState>()((set, get) => ({
    thisDevice: typeof window !== "undefined" ? detectDevice() : { id: "server", name: "Server", deviceType: "desktop" as const, browser: "Node" },
    devices: [],
    connectionStatus: "disconnected",
    enabled: false,
    activeTarget: null,
    controlledBy: null,
    browseResults: new Map(),
    queue: [],
    transferPending: null,
    _browseCallbacks: new Map(),

    setActiveTarget: (deviceId) => {
        const prev = get().activeTarget;
        if (prev === deviceId) return;

        // Release previous target
        if (prev && wsClient) {
            wsClient.send({ type: "control-release", target: prev });
        }

        set({ activeTarget: deviceId });

        // Claim new target
        if (deviceId && wsClient) {
            wsClient.send({ type: "control-claim", target: deviceId });
            const target = get().devices.find((d) => d.id === deviceId);
            toast.info(`Playing on ${target?.name ?? "remote device"}`, {
                description: "Content will play on the selected device",
                duration: 2000,
            });
        } else if (!deviceId) {
            toast.info("Playing on this device", { duration: 2000 });
        }
    },

    playOnTarget: (payload) => {
        const { activeTarget, enabled } = get();
        if (!enabled || !activeTarget) return false;

        // Verify target device is still online
        const target = get().devices.find((d) => d.id === activeTarget);
        if (!target) {
            toast.error("Target device offline", {
                description: "Switching playback to this device",
                duration: 3000,
            });
            set({ activeTarget: null });
            return false;
        }

        get().transferPlayback(activeTarget, payload);
        return true;
    },

    setEnabled: (enabled) => {
        if (get().enabled === enabled) return;
        set({ enabled });
        // Persist via settings store (single source of truth)
        useSettingsStore.getState().set("deviceSync", enabled);
        if (enabled) {
            get().connect();
        } else {
            get().disconnect();
        }
    },

    connect: async () => {
        if (!SYNC_WORKER_URL) return;

        const { _handleMessage } = get();

        // Start BroadcastChannel (always, even without WebSocket)
        if (!broadcast) {
            broadcast = new DeviceSyncBroadcast();
            broadcast.start(_handleMessage);
        }

        // Start WebSocket connection
        if (!wsClient) {
            wsClient = new DeviceSyncClient({
                syncUrl: SYNC_WORKER_URL,
                getToken: fetchToken,
                onMessage: (msg) => {
                    _handleMessage(msg);
                    // Relay WebSocket messages to other tabs
                    broadcast?.relayToTabs(msg);
                },
                onStatusChange: (status) => {
                    set({ connectionStatus: status });
                },
                getStreamingPrefs: () => {
                    const s = useSettingsStore.getState().get("streaming");
                    return {
                        profileId: s.profileId,
                        customRange: s.customRange,
                        allowUncached: s.allowUncached,
                        preferredLanguage: s.preferredLanguage,
                        preferCached: s.preferCached,
                    };
                },
            });
        }

        await wsClient.connect();
    },

    disconnect: () => {
        wsClient?.disconnect();
        wsClient = null;

        if (transferPendingTimer) {
            clearTimeout(transferPendingTimer);
            transferPendingTimer = null;
        }

        broadcast?.stop();
        broadcast = null;

        tokenCache = null;

        // Resolve any pending browse callbacks so promises don't hang
        const callbacks = get()._browseCallbacks;
        for (const [id, cb] of callbacks) {
            cb({ requestId: id, files: [], error: "Disconnected" });
        }
        callbacks.clear();

        set({
            devices: [],
            connectionStatus: "disconnected",
            activeTarget: null,
            controlledBy: null,
            transferPending: null,
        });
    },

    sendCommand: (targetId, action, payload) => {
        if (!wsClient?.sendCommand(targetId, action, payload)) {
            toast.error("Device sync unavailable", {
                description: "Reconnect and try again.",
                duration: 2500,
            });
        }
    },

    transferPlayback: (targetId, playback) => {
        if (!wsClient) return;

        const sent = wsClient.transferTo(targetId, playback);
        if (!sent) {
            toast.error("Transfer failed", {
                description: "Connection lost. Reconnect and retry.",
                duration: 3000,
            });
            set({ transferPending: null });
            return;
        }
        set({ transferPending: playback.title ?? "Loading..." });

        // Clear pending state after 30s timeout (fallback if device never reports)
        if (transferPendingTimer) {
            clearTimeout(transferPendingTimer);
        }
        transferPendingTimer = setTimeout(() => {
            if (get().transferPending) set({ transferPending: null });
            transferPendingTimer = null;
        }, 30000);

        const target = get().devices.find((d) => d.id === targetId);
        toast.success(`Transferred to ${target?.name ?? "device"}`, {
            description: playback.title,
            duration: 3000,
        });
    },

    reportNowPlaying: (state) => {
        wsClient?.reportNowPlaying(state);
        broadcast?.broadcastNowPlaying(state);
    },

    // ── Browse ─────────────────────────────────────────────────────────

    browseDevice: (targetId, request) => {
        return new Promise<BrowseResponse>((resolve) => {
            const requestId = crypto.randomUUID();
            const callbacks = get()._browseCallbacks;

            // Timeout after 15s
            const timer = setTimeout(() => {
                callbacks.delete(requestId);
                resolve({ requestId, files: [], error: "Request timed out" });
            }, 15000);

            callbacks.set(requestId, (response) => {
                clearTimeout(timer);
                callbacks.delete(requestId);
                resolve(response);
            });

            wsClient?.send({
                type: "browse-request",
                target: targetId,
                request: { ...request, requestId },
            });
        });
    },

    _respondToBrowse: (fromId, request) => {
        // This runs on the target device — it needs to actually fetch files from the debrid client
        // Dispatch a custom event so the app component that has the auth context can handle it
        window.dispatchEvent(
            new CustomEvent<{ fromId: string; request: BrowseRequest }>(
                "device-sync-browse",
                { detail: { fromId, request } }
            )
        );
    },

    /** Send a browse response back to the requesting device (used by BrowseHandler) */
    _sendBrowseResponse: (targetId: string, response: BrowseResponse) => {
        wsClient?.send({ type: "browse-response", target: targetId, response });
    },

    // ── Notifications ──────────────────────────────────────────────────

    sendNotification: (notification) => {
        const id = crypto.randomUUID();
        wsClient?.send({
            type: "notify",
            notification: { ...notification, id },
        });
    },

    // ── Queue ──────────────────────────────────────────────────────────

    queueAdd: (item) => {
        wsClient?.send({ type: "queue-add", item });
    },

    queueRemove: (itemId) => {
        wsClient?.send({ type: "queue-remove", itemId });
    },

    queueClear: () => {
        wsClient?.send({ type: "queue-clear" });
    },

    queueReorder: (itemIds) => {
        wsClient?.send({ type: "queue-reorder", itemIds });
    },

    queuePlayNext: () => {
        const queue = get().queue;
        if (queue.length === 0) return null;
        const next = queue[0];
        wsClient?.send({ type: "queue-remove", itemId: next.id });
        return next;
    },

    queueRefresh: () => {
        wsClient?.send({ type: "queue-get" });
    },

    _handleMessage: (msg) => {
        switch (msg.type) {
            case "devices": {
                // Full device list from DO — replace local state.
                // Deduplicate by name+deviceType, keeping the most recently seen entry.
                // This handles phantom entries from iOS Safari (ITP clears localStorage,
                // generating new deviceIds while old hibernated sockets linger).
                const selfId = getDeviceId();
                const seen = new Map<string, DeviceInfo>();
                for (const d of msg.devices) {
                    if (d.id === selfId) continue;
                    const key = `${d.name}::${d.deviceType}`;
                    const existing = seen.get(key);
                    if (!existing || d.lastSeen > existing.lastSeen) {
                        seen.set(key, d);
                    }
                }
                set({ devices: Array.from(seen.values()) });
                break;
            }
            case "device-joined": {
                const selfId = getDeviceId();
                if (msg.device.id === selfId) break;
                set((state) => {
                    // Filter out any existing entry with the same id OR same name+deviceType
                    // (handles reconnection with a fresh deviceId from the same physical device)
                    const replaced = state.devices.find((d) =>
                        d.id !== msg.device.id &&
                        d.name === msg.device.name && d.deviceType === msg.device.deviceType
                    );
                    // If the device we replaced was the active target, update to the new ID
                    const updatedTarget = replaced && state.activeTarget === replaced.id
                        ? msg.device.id
                        : state.activeTarget;
                    return {
                        devices: [
                            ...state.devices.filter((d) =>
                                d.id !== msg.device.id &&
                                !(d.name === msg.device.name && d.deviceType === msg.device.deviceType)
                            ),
                            msg.device,
                        ],
                        activeTarget: updatedTarget,
                    };
                });
                break;
            }
            case "device-left": {
                const wasTarget = get().activeTarget === msg.deviceId;
                set((state) => ({
                    devices: state.devices.filter((d) => d.id !== msg.deviceId),
                    activeTarget: state.activeTarget === msg.deviceId ? null : state.activeTarget,
                }));
                if (wasTarget) {
                    toast.info("Target device went offline", {
                        description: "Switched playback to this device",
                        duration: 3000,
                    });
                }
                break;
            }
            case "now-playing-update": {
                const isActiveTarget = msg.deviceId === get().activeTarget;
                if (isActiveTarget && msg.state && transferPendingTimer) {
                    clearTimeout(transferPendingTimer);
                    transferPendingTimer = null;
                }
                set((state) => ({
                    devices: state.devices.map((d) =>
                        d.id === msg.deviceId
                            ? {
                                  ...d,
                                  nowPlaying: msg.state,
                                  isPlaying: msg.state !== null && !msg.state.paused,
                              }
                            : d
                    ),
                    // Clear transfer pending when target starts playing
                    transferPending: isActiveTarget && msg.state ? null : state.transferPending,
                }));

                // Cross-device progress sync: write remote progress to localStorage
                // so "Continue Watching" picks it up on this device
                if (msg.state?.imdbId && msg.state.type && msg.state.duration > 0) {
                    const np = msg.state;
                    const percent = (np.progress / np.duration) * 100;
                    if (percent >= 0.5 && percent <= 98) {
                        const storageKey = np.type === "show" && np.season != null && np.episode != null
                            ? `progress:${np.imdbId}:s${np.season}e${np.episode}`
                            : `progress:${np.imdbId}`;
                        try {
                            const existing = localStorage.getItem(storageKey);
                            const existingData = existing ? JSON.parse(existing) : null;
                            // Only overwrite if no local data exists, or if the
                            // remote progress is further along (meaning the remote
                            // device has played more of this item than what's saved
                            // locally). This avoids regressing local progress when
                            // a remote device reports an earlier position.
                            const remoteIsNewer = !existingData
                                || np.progress > (existingData.progressSeconds ?? 0);
                            if (remoteIsNewer) {
                                localStorage.setItem(storageKey, JSON.stringify({
                                    progressSeconds: np.progress,
                                    durationSeconds: np.duration,
                                    updatedAt: Date.now(),
                                }));
                            }
                        } catch { /* ignore quota errors */ }
                    }
                }
                break;
            }
            case "command": {
                handleRemoteCommand(msg.action, msg.payload);
                break;
            }
            case "transfer": {
                handleTransfer(msg.playback, msg.fromName);
                break;
            }
            case "control-claimed": {
                set({ controlledBy: { id: msg.controllerId, name: msg.controllerName } });
                toast.info(`Controlled by ${msg.controllerName}`, {
                    description: "This device is being used as a playback target",
                    duration: 3000,
                });
                break;
            }
            case "control-released": {
                set({ controlledBy: null });
                break;
            }
            case "browse-request": {
                // A controller is asking us to list files / search
                get()._respondToBrowse(msg.from, msg.request);
                break;
            }
            case "browse-response": {
                // We received file data back from a target device
                const cb = get()._browseCallbacks.get(msg.response.requestId);
                if (cb) cb(msg.response);
                break;
            }
            case "notification": {
                const n = msg.notification;
                const toastFn =
                    n.icon === "error" ? toast.error
                    : n.icon === "warning" ? toast.warning
                    : toast.info;
                toastFn(`${n.title}`, {
                    description: n.description ? `${msg.fromName}: ${n.description}` : `From ${msg.fromName}`,
                    duration: 5000,
                    action: n.action?.transferPayload ? {
                        label: n.action.label,
                        onClick: () => {
                            if (n.action?.transferPayload) {
                                handleTransfer(n.action.transferPayload, msg.fromName);
                            }
                        },
                    } : undefined,
                });
                break;
            }
            case "queue-updated": {
                set({ queue: msg.queue });
                break;
            }
            case "error": {
                console.warn("[device-sync] Error from server:", msg.message);
                break;
            }
        }
    },
}));

// ── Auto-init on module load ───────────────────────────────────────────────

let _deviceSyncInitialized = false;

export function initDeviceSync() {
    if (typeof window === "undefined") return;
    if (!SYNC_WORKER_URL) return;
    if (_deviceSyncInitialized) return;
    _deviceSyncInitialized = true;

    // Read enabled state from settings store (persisted via Zustand)
    const enabled = useSettingsStore.getState().get("deviceSync");
    if (enabled) {
        useDeviceSyncStore.setState({ enabled: true });
        useDeviceSyncStore.getState().connect();
    }

    // Subscribe to settings changes so toggling in settings page auto-connects/disconnects
    let prevSync = enabled;
    useSettingsStore.subscribe((state) => {
        const cur = state.settings.deviceSync;
        if (cur === prevSync) return;
        prevSync = cur;
        const store = useDeviceSyncStore.getState();
        if (cur && !store.enabled) {
            store.setEnabled(true);
        } else if (!cur && store.enabled) {
            store.setEnabled(false);
        }
    });

    // Reconnect when tab becomes visible (handles the case where this tab's WS
    // was replaced by another tab that has since been closed)
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        const store = useDeviceSyncStore.getState();
        if (store.enabled && store.connectionStatus === "disconnected") {
            store.connect();
        }
    });

    // Clean up on page unload
    window.addEventListener("beforeunload", () => {
        wsClient?.disconnect();
        broadcast?.stop();
    });
}
