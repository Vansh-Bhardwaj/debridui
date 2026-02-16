"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import type { DeviceInfo, RemoteAction, SourceSummary } from "@/lib/device-sync/protocol";
import {
    Monitor,
    Smartphone,
    Tablet,
    Tv,
    Pause,
    Play,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeX,
    X,
    ChevronUp,
    ChevronDown,
    AudioLines,
    Subtitles,
    Maximize2,
    Loader2,
    Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useStreamingStore } from "@/lib/stores/streaming";
import { PlaybackQueue } from "@/components/device-sync/playback-queue";
import { RemoteFileBrowser } from "@/components/device-sync/remote-file-browser";

function DeviceTypeIcon({ type, className }: { type: DeviceInfo["deviceType"]; className?: string }) {
    const props = { className: cn("size-4", className) };
    switch (type) {
        case "mobile":
            return <Smartphone {...props} />;
        case "tablet":
            return <Tablet {...props} />;
        case "tv":
            return <Tv {...props} />;
        default:
            return <Monitor {...props} />;
    }
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Remote Control Banner — large, full-featured controller when expanded.
 *
 * Collapsed: thin title bar with media info.
 * Expanded: spacious card with seek, transport, volume, audio/subtitle tracks,
 * fullscreen, episode nav — modelled after Spotify's device control panel.
 */
export const RemoteControlBanner = memo(function RemoteControlBanner() {
    const devices = useDeviceSyncStore((s) => s.devices);
    const activeTarget = useDeviceSyncStore((s) => s.activeTarget);
    const setActiveTarget = useDeviceSyncStore((s) => s.setActiveTarget);
    const sendCommand = useDeviceSyncStore((s) => s.sendCommand);
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const transferPending = useDeviceSyncStore((s) => s.transferPending);
    const allFetchedSources = useStreamingStore((s) => s.allFetchedSources);

    const [collapsed, setCollapsed] = useState(true);
    const [seekActive, setSeekActive] = useState(false);
    const [seekValue, setSeekValue] = useState(0);
    const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Priority: show active target, otherwise first playing device
    const targetDevice = activeTarget
        ? devices.find((d) => d.id === activeTarget)
        : devices.find((d) => d.isPlaying && d.nowPlaying);

    const cmd = useCallback(
        (action: RemoteAction, payload?: Record<string, unknown>) => {
            if (!targetDevice) return;
            sendCommand(targetDevice.id, action, payload);
        },
        [targetDevice, sendCommand],
    );

    // Commit seek — send command and hold seekValue visible for 3s to avoid snap-back
    const commitSeek = useCallback(
        (position: number) => {
            cmd("seek", { position });
            // Keep showing the seeked position until remote catches up
            if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
            seekTimeoutRef.current = setTimeout(() => setSeekActive(false), 3000);
        },
        [cmd],
    );

    const nowPlaying = targetDevice?.nowPlaying ?? null;

    // Controller-side source play for remote targets that don't report their own sources
    const handleLocalSourcePlay = useCallback((index: number) => {
        const source = allFetchedSources[index];
        if (!source?.url) return;
        const store = useStreamingStore.getState();
        store.playSource(source, nowPlaying?.title ?? "Video", {
            progressKey: store.getProgressKey() ?? undefined,
        });
    }, [allFetchedSources, nowPlaying?.title]);

    // Auto-expand when playback starts — subscribe to store changes outside render
    useEffect(() => {
        let prev = false;
        const unsub = useDeviceSyncStore.subscribe((s) => {
            const target = s.activeTarget
                ? s.devices.find((d) => d.id === s.activeTarget)
                : s.devices.find((d) => d.isPlaying && d.nowPlaying);
            const active = !!(target?.nowPlaying || s.transferPending);
            if (active && !prev) setCollapsed(false);
            prev = active;
        });
        return unsub;
    }, []);

    if (!enabled || !targetDevice) return null;

    const isPlaying = nowPlaying && !nowPlaying.paused;
    const currentTime = nowPlaying?.progress ?? 0;
    const duration = nowPlaying?.duration ?? 0;
    // Seek display: while dragging or shortly after release, show seekValue
    const displayTime = seekActive ? seekValue : currentTime;
    const progress = duration > 0 ? (displayTime / duration) * 100 : 0;
    const volume = nowPlaying?.volume ?? 100;
    const isMuted = volume === 0;
    const audioTracks = nowPlaying?.audioTracks ?? [];
    const subtitleTracks = nowPlaying?.subtitleTracks ?? [];

    // Merge controller-side sources when target doesn't report its own
    const remoteSources = nowPlaying?.sources;
    const hasRemoteSources = remoteSources && remoteSources.length > 0;
    const displaySources = hasRemoteSources
        ? remoteSources
        : allFetchedSources.length > 0
        ? allFetchedSources.map((s, i): SourceSummary => ({
            index: i,
            title: s.title,
            resolution: s.resolution,
            quality: s.quality,
            size: s.size,
            isCached: s.isCached,
            addonName: s.addonName,
        }))
        : undefined;

    return (
        <div role="region" aria-label="Remote player" className="pointer-events-auto mx-auto max-w-lg px-2 sm:px-4 pb-3 sm:pb-4">
            <div className="rounded-sm border border-border bg-card/95 backdrop-blur-md shadow-xl overflow-hidden w-full">
                    {/* Collapse toggle — title bar */}
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setCollapsed((c) => !c)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed((c) => !c); } }}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? "Expand remote player" : "Collapse remote player"}
                        className="flex w-full items-center gap-1.5 px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors border-b border-border/30 cursor-pointer select-none"
                    >
                        <DeviceTypeIcon type={targetDevice.deviceType} className="size-3.5 text-primary" />
                        <span className="flex-1 text-left truncate font-medium">
                            {nowPlaying ? nowPlaying.title : targetDevice.name}
                        </span>
                        <span className="text-muted-foreground/60 text-[9px] mr-1 hidden sm:inline">
                            {nowPlaying ? targetDevice.name : "Connected"}
                        </span>
                        {!nowPlaying && !transferPending && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setActiveTarget(null); }}
                                className="p-0.5 rounded-sm hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="Disconnect"
                                title="Disconnect"
                            >
                                <X className="size-3" />
                            </button>
                        )}
                        {collapsed ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    </div>

                    {/* ── Expanded: Full Remote ─────────────────────────── */}
                    {!collapsed && nowPlaying && (
                        <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 sm:pt-3 space-y-3 sm:space-y-4 max-h-[55vh] overflow-y-auto">
                            {/* Title + metadata */}
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium truncate">{nowPlaying.title}</p>
                                <p className="text-xs text-muted-foreground">
                                    {targetDevice.name}
                                    {nowPlaying.type === "show" && nowPlaying.season && nowPlaying.episode && (
                                        <> <span className="text-border">·</span> S{String(nowPlaying.season).padStart(2, "0")}E{String(nowPlaying.episode).padStart(2, "0")}</>
                                    )}
                                </p>
                            </div>

                            {/* Seek bar */}
                            <div className="space-y-1">
                                <input
                                    type="range"
                                    min={0}
                                    max={duration > 0 ? duration : 0}
                                    step={1}
                                    value={displayTime}
                                    aria-label="Seek"
                                    aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
                                    onChange={(e) => {
                                        setSeekActive(true);
                                        setSeekValue(Number(e.target.value));
                                    }}
                                    onMouseUp={() => commitSeek(seekValue)}
                                    onTouchEnd={() => commitSeek(seekValue)}
                                    className="w-full h-1.5 cursor-pointer appearance-none rounded-full accent-primary"
                                    style={{
                                        background: `linear-gradient(to right, var(--primary) ${progress}%, var(--muted) ${progress}%)`,
                                    }}
                                />
                                <div className="flex justify-between">
                                    <span className="text-[10px] tabular-nums text-muted-foreground">
                                        {formatTime(displayTime)}
                                    </span>
                                    <span className="text-[10px] tabular-nums text-muted-foreground">
                                        {formatTime(duration)}
                                    </span>
                                </div>
                            </div>

                            {/* Transport controls — centered, responsive */}
                            <div className="flex items-center justify-center gap-1 sm:gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 sm:size-9 text-[10px] sm:text-xs tabular-nums font-medium"
                                    onClick={() => cmd("seek", { position: Math.max(0, currentTime - 10) })}
                                    title="Rewind 10s"
                                    aria-label="Rewind 10 seconds"
                                >
                                    -10
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 sm:size-8"
                                    onClick={() => cmd("previous")}
                                    title="Previous"
                                    aria-label="Previous"
                                >
                                    <SkipBack className="size-3.5 sm:size-4 fill-current" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-10 sm:size-11 rounded-full"
                                    onClick={() => cmd("toggle-pause")}
                                    title={isPlaying ? "Pause" : "Play"}
                                    aria-label={isPlaying ? "Pause" : "Play"}
                                >
                                    {isPlaying ? (
                                        <Pause className="size-4 sm:size-5 fill-current" />
                                    ) : (
                                        <Play className="size-4 sm:size-5 fill-current ml-0.5" />
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 sm:size-8"
                                    onClick={() => cmd("next")}
                                    title="Next"
                                    aria-label="Next"
                                >
                                    <SkipForward className="size-3.5 sm:size-4 fill-current" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 sm:size-9 text-[10px] sm:text-xs tabular-nums font-medium"
                                    onClick={() => cmd("seek", { position: Math.min(duration, currentTime + 10) })}
                                    title="Forward 10s"
                                    aria-label="Forward 10 seconds"
                                >
                                    +10
                                </Button>
                            </div>

                            {/* Volume — always visible slider */}
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 shrink-0"
                                    onClick={() => cmd("volume", { level: isMuted ? 1 : 0 })}
                                    title={isMuted ? "Unmute" : "Mute"}
                                    aria-label={isMuted ? "Unmute" : "Mute"}
                                >
                                    {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                                </Button>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={volume}
                                    aria-label="Volume"
                                    onChange={(e) => cmd("volume", { level: Number(e.target.value) / 100 })}
                                    className="flex-1 h-1 cursor-pointer appearance-none rounded-full accent-primary"
                                    style={{
                                        background: `linear-gradient(to right, var(--primary) ${volume}%, var(--muted) ${volume}%)`,
                                    }}
                                />
                            </div>

                            {/* Playback queue */}
                            <PlaybackQueue compact />

                            {/* Sources (alternative streams) — uses target-reported or controller-cached */}
                            {displaySources && displaySources.length > 0 && (
                                <BannerSourcesSection
                                    sources={displaySources}
                                    onCommand={hasRemoteSources ? cmd : undefined}
                                    onPlayLocalSource={!hasRemoteSources ? handleLocalSourcePlay : undefined}
                                />
                            )}

                            {/* Bottom row: track selectors + fullscreen + stop */}
                            <div className="flex items-center justify-between border-t border-border/30 pt-2 sm:pt-3 flex-wrap gap-y-1">
                                <div className="flex items-center gap-1">
                                    {/* Audio tracks */}
                                    {audioTracks.length > 0 && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" title="Audio Track" aria-label="Audio Track">
                                                    <AudioLines className="size-3.5" />
                                                    <span className="hidden sm:inline">Audio</span>
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal>
                                                <DropdownMenuContent align="start" side="top" className="max-h-48 overflow-y-auto">
                                                    {audioTracks.map((t) => (
                                                        <DropdownMenuItem
                                                            key={t.id}
                                                            onClick={() => cmd("set-audio-track", { trackId: t.id })}
                                                            className={cn(t.active && "text-primary font-medium")}
                                                        >
                                                            {t.name}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {/* Subtitle tracks */}
                                    {subtitleTracks.length > 0 && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" title="Subtitles" aria-label="Subtitles">
                                                    <Subtitles className="size-3.5" />
                                                    <span className="hidden sm:inline">Subtitles</span>
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal>
                                                <DropdownMenuContent align="start" side="top" className="max-h-48 overflow-y-auto">
                                                    <DropdownMenuItem
                                                        onClick={() => cmd("set-subtitle-track", { trackId: -1 })}
                                                        className={cn(!subtitleTracks.some((t) => t.active) && "text-primary font-medium")}
                                                    >
                                                        Off
                                                    </DropdownMenuItem>
                                                    {subtitleTracks.map((t) => (
                                                        <DropdownMenuItem
                                                            key={t.id}
                                                            onClick={() => cmd("set-subtitle-track", { trackId: t.id })}
                                                            className={cn(t.active && "text-primary font-medium")}
                                                        >
                                                            {t.name}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {/* Fullscreen */}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        onClick={() => cmd("fullscreen")}
                                        title="Fullscreen"
                                        aria-label="Toggle fullscreen"
                                    >
                                        <Maximize2 className="size-3.5" />
                                    </Button>
                                </div>

                                {/* Stop & disconnect */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1.5 shrink-0"
                                    onClick={() => {
                                        cmd("stop");
                                        setActiveTarget(null);
                                    }}
                                    title="Stop & Disconnect"
                                    aria-label="Stop and disconnect"
                                >
                                    <X className="size-3.5" />
                                    Disconnect
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Loading state (transfer pending, nothing playing yet) */}
                    {!collapsed && !nowPlaying && transferPending && (
                        <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-center gap-2 sm:gap-3">
                            <Loader2 className="size-4 animate-spin text-primary shrink-0" />
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{transferPending}</p>
                                <p className="text-[10px] text-muted-foreground">Loading on {targetDevice.name}…</p>
                            </div>
                        </div>
                    )}

                    {/* Idle state (selected but nothing playing) — always mounted to preserve file browser state */}
                    {!nowPlaying && !transferPending && (
                        <div className={cn("px-3 sm:px-4 pb-3 pt-2 max-h-[45vh] overflow-y-auto overflow-x-hidden", collapsed && "hidden")}>
                            <RemoteFileBrowser targetDeviceId={targetDevice.id} compact />
                            <PlaybackQueue compact />
                        </div>
                    )}
                </div>
            </div>
    );
});

// ── Banner Sources Section ─────────────────────────────────────────────────

function BannerSourcesSection({
    sources,
    onCommand,
    onPlayLocalSource,
}: {
    sources: SourceSummary[];
    onCommand?: (action: RemoteAction, payload?: Record<string, unknown>) => void;
    onPlayLocalSource?: (index: number) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="border-t border-border/30 -mx-3 sm:-mx-4">
            <button
                onClick={() => setExpanded((e) => !e)}
                className="flex items-center justify-between w-full px-3 sm:px-4 py-2 text-left hover:bg-muted/20 transition-colors"
            >
                <div className="flex items-center gap-1.5">
                    <Layers className="size-3 text-muted-foreground" />
                    <span className="text-[10px] tracking-widest uppercase text-muted-foreground">
                        Sources
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                        {sources.length}
                    </span>
                </div>
                {expanded ? <ChevronUp className="size-3 text-muted-foreground" /> : <ChevronDown className="size-3 text-muted-foreground" />}
            </button>
            {expanded && (
                <div className="px-3 sm:px-4 pb-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {sources.map((source) => {
                        const meta = [source.resolution, source.quality, source.size].filter(Boolean).join(" · ");
                        return (
                            <button
                                key={source.index}
                                onClick={() => onPlayLocalSource ? onPlayLocalSource(source.index) : onCommand?.("play-source", { index: source.index })}
                                className="flex items-start gap-1.5 w-full rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-muted/30"
                            >
                                <span className="text-[10px] w-4 text-center shrink-0 tabular-nums text-muted-foreground mt-0.5">
                                    {source.index + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] truncate">{source.title}</p>
                                    <div className="flex items-center gap-1 mt-0.5">
                                        {meta && (
                                            <span className="text-[10px] text-muted-foreground">{meta}</span>
                                        )}
                                        {source.isCached && (
                                            <span className="text-[10px] text-green-500 font-medium">Cached</span>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-muted-foreground/50">{source.addonName}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
