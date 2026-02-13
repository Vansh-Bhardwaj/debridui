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
import type { NowPlayingInfo } from "@/lib/device-sync/protocol";
import { getVLCProgressSession } from "@/lib/vlc-progress";

const REPORT_INTERVAL_MS = 5000; // Report every 5s during playback

export function DeviceSyncReporter() {
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const reportNowPlaying = useDeviceSyncStore((s) => s.reportNowPlaying);

    // Get preview metadata for title/progress key
    const directTitle = usePreviewStore((s) => s.directTitle);
    const progressKey = usePreviewStore((s) => s.progressKey);
    const isOpen = usePreviewStore((s) => s.isOpen);

    const lastReportRef = useRef(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Browser <video> monitoring ────────────────────────────────────

    useEffect(() => {
        if (!enabled) return;

        const buildNowPlaying = (video: HTMLVideoElement): NowPlayingInfo | null => {
            if (!video.src && !video.currentSrc) return null;
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

        const attachToVideo = (video: HTMLVideoElement) => {
            video.addEventListener("play", onPlay);
            video.addEventListener("pause", onPause);
            video.addEventListener("ended", onEnded);
        };

        const detachFromVideo = (video: HTMLVideoElement) => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("ended", onEnded);
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
            if (video && !video.paused && video.currentTime > 0) {
                const state = buildNowPlaying(video);
                if (state) reportNowPlaying(state);
                return;
            }

            // VLC fallback: if no browser video playing, check VLC status
            const vlcSession = getVLCProgressSession();
            if (vlcSession) {
                import("@/lib/stores/vlc").then(({ useVLCStore }) => {
                    const vlcState = useVLCStore.getState();
                    const { status, nowPlaying } = vlcState;
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
    }, [enabled, reportNowPlaying, directTitle, progressKey]);

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
