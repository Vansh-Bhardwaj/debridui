"use client";

import { useEffect, useState } from "react";

interface DiagnosticsOverlayProps {
    open: boolean;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    sourceUrl?: string | null;
    sourceLabel?: string | null;
}

interface Snapshot {
    resolution: string;
    bufferedAhead: string;
    droppedFrames: number;
    totalFrames: number;
    playbackRate: string;
    volume: string;
    networkState: string;
    readyState: string;
}

const NETWORK_STATES = ["empty", "idle", "loading", "no-source"] as const;
const READY_STATES = ["nothing", "metadata", "current", "future", "enough"] as const;

function readSnapshot(video: HTMLVideoElement | null): Snapshot {
    if (!video) {
        return {
            resolution: "—",
            bufferedAhead: "—",
            droppedFrames: 0,
            totalFrames: 0,
            playbackRate: "—",
            volume: "—",
            networkState: "—",
            readyState: "—",
        };
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    const resolution = w && h ? `${w}×${h}` : "—";

    let bufferedAhead = "—";
    try {
        const ranges = video.buffered;
        if (ranges.length > 0) {
            const end = ranges.end(ranges.length - 1);
            const ahead = Math.max(0, end - video.currentTime);
            bufferedAhead = `${ahead.toFixed(1)}s`;
        }
    } catch { /* noop */ }

    let droppedFrames = 0;
    let totalFrames = 0;
    const withQuality = video as HTMLVideoElement & { getVideoPlaybackQuality?: () => VideoPlaybackQuality };
    const q = withQuality.getVideoPlaybackQuality?.();
    if (q) {
        droppedFrames = q.droppedVideoFrames;
        totalFrames = q.totalVideoFrames;
    }

    return {
        resolution,
        bufferedAhead,
        droppedFrames,
        totalFrames,
        playbackRate: `${video.playbackRate.toFixed(2)}x`,
        volume: video.muted ? "muted" : `${Math.round(video.volume * 100)}%`,
        networkState: NETWORK_STATES[video.networkState] ?? String(video.networkState),
        readyState: READY_STATES[video.readyState] ?? String(video.readyState),
    };
}

/**
 * Press D inside the player to toggle. Shows live codec, resolution,
 * buffer health, dropped frames, playback rate, and source URL.
 * Read-only — does not affect playback.
 */
export function DiagnosticsOverlay({ open, videoRef, sourceUrl, sourceLabel }: DiagnosticsOverlayProps) {
    const [snap, setSnap] = useState<Snapshot>(() => readSnapshot(null));

    useEffect(() => {
        if (!open) return;
        const tick = () => setSnap(readSnapshot(videoRef.current));
        tick();
        const id = window.setInterval(tick, 500);
        return () => window.clearInterval(id);
    }, [open, videoRef]);

    if (!open) return null;

    const dropPct = snap.totalFrames > 0 ? ((snap.droppedFrames / snap.totalFrames) * 100).toFixed(2) : "0.00";

    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute top-3 right-3 z-40 max-w-[min(24rem,60vw)] select-none rounded-sm border border-white/10 bg-black/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/90 backdrop-blur-sm shadow-lg"
        >
            <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] tracking-widest uppercase text-white/50">
                <span>Diagnostics</span>
                <span>Press D to hide</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <span className="text-white/50">Resolution</span><span>{snap.resolution}</span>
                <span className="text-white/50">Buffer</span><span>{snap.bufferedAhead} ahead</span>
                <span className="text-white/50">Dropped</span><span>{snap.droppedFrames} / {snap.totalFrames} ({dropPct}%)</span>
                <span className="text-white/50">Rate</span><span>{snap.playbackRate}</span>
                <span className="text-white/50">Volume</span><span>{snap.volume}</span>
                <span className="text-white/50">Network</span><span>{snap.networkState}</span>
                <span className="text-white/50">Ready</span><span>{snap.readyState}</span>
                {sourceLabel ? (
                    <>
                        <span className="text-white/50">Source</span><span className="truncate">{sourceLabel}</span>
                    </>
                ) : null}
                {sourceUrl ? (
                    <>
                        <span className="text-white/50">URL</span>
                        <span className="truncate" title={sourceUrl}>{sourceUrl}</span>
                    </>
                ) : null}
            </div>
        </div>
    );
}
