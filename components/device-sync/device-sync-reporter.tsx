/**
 * Device Sync Reporter — monitors browser video playback and VLC status,
 * reporting now-playing state to the device sync store.
 *
 * Browser: Attaches to any <video> element via MutationObserver + event listeners.
 * VLC: Subscribes to the VLC store's status updates.
 * Zero modifications to the video player or VLC code.
 */

"use client";

import { useEffect, useRef } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import { usePreviewStore } from "@/lib/stores/preview";
import type { NowPlayingInfo, SourceSummary, TrackInfo } from "@/lib/device-sync/protocol";
import { getVLCProgressSession } from "@/lib/vlc-progress";
import { queryClient } from "@/lib/query-client";
import type { Addon } from "@/lib/addons/types";

const REPORT_INTERVAL_MS = 5000; // Report every 5s during playback

/** Cache the streaming store module after first lazy load. */
let _streamingStoreModule: typeof import("@/lib/stores/streaming") | null = null;

/** Build compact source summaries from the streaming store's fetched sources. */
function getSourceSummaries(): SourceSummary[] | undefined {
    if (!_streamingStoreModule) return undefined;
    const sources = _streamingStoreModule.useStreamingStore.getState().allFetchedSources;
    if (!sources?.length) return undefined;
    return sources.map((s, i) => ({
        index: i,
        title: s.title,
        resolution: s.resolution,
        quality: s.quality,
        size: s.size,
        isCached: s.isCached,
        addonName: s.addonName,
    }));
}

/** Eagerly lazy-load the streaming store module so getSourceSummaries works. */
function ensureStreamingStore(): Promise<typeof import("@/lib/stores/streaming")> {
    if (_streamingStoreModule) return Promise.resolve(_streamingStoreModule);
    return import("@/lib/stores/streaming").then((m) => {
        _streamingStoreModule = m;
        return m;
    });
}

export function DeviceSyncReporter() {
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const reportNowPlaying = useDeviceSyncStore((s) => s.reportNowPlaying);

    // Get preview metadata for title/progress key + subtitles
    const directTitle = usePreviewStore((s) => s.directTitle);
    const progressKey = usePreviewStore((s) => s.progressKey);
    const isOpen = usePreviewStore((s) => s.isOpen);
    const directSubtitles = usePreviewStore((s) => s.directSubtitles);

    const lastReportRef = useRef(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Use refs for values consumed inside buildNowPlaying so the main effect
    // doesn't tear down on every metadata/subtitle change.
    const directTitleRef = useRef(directTitle);
    directTitleRef.current = directTitle;
    const progressKeyRef = useRef(progressKey);
    progressKeyRef.current = progressKey;
    const directSubtitlesRef = useRef(directSubtitles);
    directSubtitlesRef.current = directSubtitles;

    // Eagerly load streaming store so getSourceSummaries() works in reports
    useEffect(() => {
        if (enabled) ensureStreamingStore();
    }, [enabled]);

    // ── Browser <video> monitoring ────────────────────────────────────

    useEffect(() => {
        if (!enabled) return;

        const buildNowPlaying = (video: HTMLVideoElement): NowPlayingInfo | null => {
            if (!video.src && !video.currentSrc) return null;

            // Use subtitles from the preview store (custom overlay renderer)
            // rather than native textTracks (which are disabled in our player)
            const activeSubIdx = parseInt(video.dataset.activeSubtitle ?? "-1", 10);
            const subtitleTracks: TrackInfo[] = directSubtitlesRef.current.map((s, i) => ({
                id: i,
                name: s.name || s.lang || `Track ${i + 1}`,
                active: i === activeSubIdx,
            }));

            // Try to read audio tracks (Safari supports HTMLMediaElement.audioTracks)
            const audioTracks: TrackInfo[] = [];
            const audioTrackList = (video as unknown as { audioTracks?: { length: number; [index: number]: { label?: string; language?: string; enabled?: boolean } } }).audioTracks;
            if (audioTrackList?.length) {
                for (let i = 0; i < audioTrackList.length; i++) {
                    const t = audioTrackList[i];
                    audioTracks.push({
                        id: i,
                        name: t.label || t.language || `Track ${i + 1}`,
                        active: t.enabled,
                    });
                }
            }

            return {
                title: directTitleRef.current || document.title || "Video",
                imdbId: progressKeyRef.current?.imdbId,
                type: progressKeyRef.current?.type,
                season: progressKeyRef.current?.season,
                episode: progressKeyRef.current?.episode,
                progress: Math.round(video.currentTime),
                duration: Math.round(video.duration || 0),
                paused: video.paused,
                url: video.currentSrc || video.src,
                volume: Math.round(video.volume * 100),
                audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
                subtitleTracks: subtitleTracks.length > 0 ? subtitleTracks : undefined,
                sources: getSourceSummaries(),
            };
        };

        const report = (video: HTMLVideoElement) => {
            const now = Date.now();
            if (now - lastReportRef.current < 2000) return; // Debounce
            lastReportRef.current = now;
            const state = buildNowPlaying(video);
            // Only send non-null state from event handlers; null clears the remote display.
            // Explicit null is sent by onEnded and the preview-close effect instead.
            if (state) reportNowPlaying(state);
        };

        const onPlay = (e: Event) => report(e.target as HTMLVideoElement);
        const onPause = (e: Event) => report(e.target as HTMLVideoElement);
        const onEnded = () => {
            // Don't immediately clear now-playing — if auto-next fires, the new
            // episode will update the state. Use a short delay so the controller
            // doesn't flash "No media playing" during episode transitions.
            setTimeout(() => {
                // Only clear if no new video has started (auto-next creates a new video element)
                const currentVideo = document.querySelector("video");
                if (!currentVideo || (!currentVideo.src && !currentVideo.currentSrc)) {
                    reportNowPlaying(null);
                }
            }, 1500);
        };

        const onLoadedData = (e: Event) => report(e.target as HTMLVideoElement);

        const attachToVideo = (video: HTMLVideoElement) => {
            video.addEventListener("play", onPlay);
            video.addEventListener("pause", onPause);
            video.addEventListener("ended", onEnded);
            video.addEventListener("loadeddata", onLoadedData, { once: true });
            // If already loaded (e.g. cached), report immediately
            if (video.readyState >= 2) report(video);
        };

        const detachFromVideo = (video: HTMLVideoElement) => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("ended", onEnded);
            video.removeEventListener("loadeddata", onLoadedData);
        };

        // Attach to any existing video elements
        const videos = document.querySelectorAll("video");
        videos.forEach(attachToVideo);

        // Watch for new video elements being added/removed
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLVideoElement) attachToVideo(node);
                    if (node instanceof HTMLElement) {
                        node.querySelectorAll("video").forEach(attachToVideo);
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node instanceof HTMLVideoElement) {
                        detachFromVideo(node);
                        reportNowPlaying(null);
                    } else if (node instanceof HTMLElement) {
                        // Detach from any nested video elements to prevent listener leaks
                        node.querySelectorAll("video").forEach((v) => {
                            detachFromVideo(v);
                        });
                        if (node.querySelector("video")) {
                            reportNowPlaying(null);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Periodic reporting during playback (for progress updates)
        intervalRef.current = setInterval(() => {
            const video = document.querySelector("video");
            if (video && (video.src || video.currentSrc)) {
                // Report both playing and paused states so remote controller
                // shows playback controls (not "Loading...") as soon as video loads
                const state = buildNowPlaying(video);
                if (state) reportNowPlaying(state);
                return;
            }

            // VLC fallback: if no browser video playing, check VLC status
            const vlcSession = getVLCProgressSession();
            if (vlcSession) {
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    const vlcState = useVLCStore.getState();
                    const { status, nowPlaying, audioTracks, subtitleTracks } = vlcState;
                    if (status && status.length > 0) {
                        reportNowPlaying({
                            title: nowPlaying || "VLC Playback",
                            imdbId: vlcSession.imdbId,
                            type: vlcSession.type,
                            season: vlcSession.season,
                            episode: vlcSession.episode,
                            progress: status.time,
                            duration: status.length,
                            paused: status.state === "paused",
                            volume: Math.round((status.volume / 256) * 100),
                            audioTracks: audioTracks.map((t) => ({
                                id: t.id,
                                name: t.name,
                            })),
                            subtitleTracks: subtitleTracks.map((t) => ({
                                id: t.id,
                                name: t.name,
                            })),
                            sources: getSourceSummaries(),
                        });
                    }
                });
            }
        }, REPORT_INTERVAL_MS);

        return () => {
            observer.disconnect();
            if (intervalRef.current) clearInterval(intervalRef.current);
            document.querySelectorAll("video").forEach(detachFromVideo);
        };
    }, [enabled, reportNowPlaying]);

    // ── Report null when preview closes ───────────────────────────────

    useEffect(() => {
        if (!enabled) return;
        if (!isOpen) {
            // Small delay to avoid race with video element removal
            const timer = setTimeout(() => {
                // Only clear if there's no VLC session active
                if (!getVLCProgressSession()) {
                    reportNowPlaying(null);
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [enabled, isOpen, reportNowPlaying]);

    // ── Handle remote play-episode commands ───────────────────────────

    useEffect(() => {
        if (!enabled) return;

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as {
                imdbId: string;
                season: number;
                episode: number;
                title: string;
            };
            if (!detail?.imdbId) return;

            // Get addons from React Query cache (no hook needed)
            const addons = queryClient.getQueryData<Addon[]>(["user-addons"]) ?? [];
            const enabledAddons = addons
                .filter((a) => a.enabled)
                .sort((a, b) => a.order - b.order)
                .map((a) => ({ id: a.id, url: a.url, name: a.name }));

            if (enabledAddons.length === 0) return;

            // Force autoplay — remote user can't see/click the toast on this device
            ensureStreamingStore().then(({ useStreamingStore }) => {
                useStreamingStore.getState().play(
                    {
                        imdbId: detail.imdbId,
                        type: "show",
                        title: detail.title || "Episode",
                        tvParams: { season: detail.season, episode: detail.episode },
                    },
                    enabledAddons,
                    { forceAutoPlay: true }
                );
            });
        };

        window.addEventListener("device-sync-play-episode", handler);
        return () => window.removeEventListener("device-sync-play-episode", handler);
    }, [enabled]);

    // ── Handle remote play-media commands (movies + shows) ───────────

    useEffect(() => {
        if (!enabled) return;

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as {
                imdbId: string;
                type: "movie" | "show";
                title: string;
                season?: number;
                episode?: number;
            };
            if (!detail?.imdbId || !detail.type) return;

            const addons = queryClient.getQueryData<Addon[]>(["user-addons"]) ?? [];
            const enabledAddons = addons
                .filter((a) => a.enabled)
                .sort((a, b) => a.order - b.order)
                .map((a) => ({ id: a.id, url: a.url, name: a.name }));

            if (enabledAddons.length === 0) return;

            ensureStreamingStore().then(({ useStreamingStore }) => {
                useStreamingStore.getState().play(
                    {
                        imdbId: detail.imdbId,
                        type: detail.type,
                        title: detail.title || (detail.type === "movie" ? "Movie" : "Episode"),
                        ...(detail.type === "show" && detail.season != null && detail.episode != null
                            ? { tvParams: { season: detail.season, episode: detail.episode } }
                            : {}),
                    },
                    enabledAddons,
                    { forceAutoPlay: true }
                );
            });
        };

        window.addEventListener("device-sync-play-media", handler);
        return () => window.removeEventListener("device-sync-play-media", handler);
    }, [enabled]);

    // ── Handle remote next/previous for browser playback ─────────────

    useEffect(() => {
        if (!enabled) return;

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { direction: "next" | "previous" };
            if (!detail?.direction) return;

            // Only handle if browser video is active (VLC mini-player has its own listener)
            const video = document.querySelector("video");
            if (!video) return;

            const addons = queryClient.getQueryData<Addon[]>(["user-addons"]) ?? [];
            const enabledAddons = addons
                .filter((a) => a.enabled)
                .sort((a, b) => a.order - b.order)
                .map((a) => ({ id: a.id, url: a.url, name: a.name }));

            if (enabledAddons.length === 0) return;

            ensureStreamingStore().then(({ useStreamingStore }) => {
                const store = useStreamingStore.getState();
                if (detail.direction === "next") {
                    store.playNextEpisode(enabledAddons, { forceAutoPlay: true });
                } else {
                    store.playPreviousEpisode(enabledAddons, { forceAutoPlay: true });
                }
            });
        };

        window.addEventListener("device-sync-navigate", handler);
        return () => window.removeEventListener("device-sync-navigate", handler);
    }, [enabled]);

    // ── Handle remote play-source commands ────────────────────────────

    useEffect(() => {
        if (!enabled) return;

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { index: number };
            if (detail?.index == null) return;

            ensureStreamingStore().then(({ useStreamingStore }) => {
                const store = useStreamingStore.getState();
                const source = store.allFetchedSources[detail.index];
                if (!source?.url) return;

                // Build title from active request or source title
                const title = store.episodeContext
                    ? `${store.episodeContext.title} S${String(store.episodeContext.season).padStart(2, "0")}E${String(store.episodeContext.episode).padStart(2, "0")}`
                    : source.title;

                // Preserve subtitles from the current playback session
                const currentSubs = usePreviewStore.getState().directSubtitles;

                store.playSource(source, title, {
                    progressKey: store.getProgressKey() ?? undefined,
                    subtitles: currentSubs.length > 0 ? currentSubs : undefined,
                });
            });
        };

        window.addEventListener("device-sync-play-source", handler);
        return () => window.removeEventListener("device-sync-play-source", handler);
    }, [enabled]);

    return null;
}
