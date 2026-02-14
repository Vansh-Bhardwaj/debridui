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
import type { NowPlayingInfo, TrackInfo } from "@/lib/device-sync/protocol";
import { getVLCProgressSession } from "@/lib/vlc-progress";

const REPORT_INTERVAL_MS = 5000; // Report every 5s during playback

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

    // ── Browser <video> monitoring ────────────────────────────────────

    useEffect(() => {
        if (!enabled) return;

        const buildNowPlaying = (video: HTMLVideoElement): NowPlayingInfo | null => {
            if (!video.src && !video.currentSrc) return null;

            // Use subtitles from the preview store (custom overlay renderer)
            // rather than native textTracks (which are disabled in our player)
            const subtitleTracks: TrackInfo[] = directSubtitles.map((s, i) => ({
                id: i,
                name: s.name || s.lang || `Track ${i + 1}`,
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
                title: directTitle || document.title || "Video",
                imdbId: progressKey?.imdbId,
                type: progressKey?.type,
                season: progressKey?.season,
                episode: progressKey?.episode,
                progress: Math.round(video.currentTime),
                duration: Math.round(video.duration || 0),
                paused: video.paused,
                url: video.currentSrc || video.src,
                volume: Math.round(video.volume * 100),
                audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
                subtitleTracks: subtitleTracks.length > 0 ? subtitleTracks : undefined,
            };
        };

        const report = (video: HTMLVideoElement) => {
            const now = Date.now();
            if (now - lastReportRef.current < 2000) return; // Debounce
            lastReportRef.current = now;
            const state = buildNowPlaying(video);
            reportNowPlaying(state);
        };

        const onPlay = (e: Event) => report(e.target as HTMLVideoElement);
        const onPause = (e: Event) => report(e.target as HTMLVideoElement);
        const onEnded = () => reportNowPlaying(null);

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
                    }
                    if (node instanceof HTMLElement && node.querySelector("video")) {
                        reportNowPlaying(null);
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
    }, [enabled, reportNowPlaying, directTitle, progressKey, directSubtitles]);

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

    return null;
}
