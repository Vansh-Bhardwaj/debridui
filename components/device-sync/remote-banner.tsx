"use client";

import { memo, useCallback, useRef, useState } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import type { DeviceInfo, RemoteAction } from "@/lib/device-sync/protocol";
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
    Cast,
    ChevronUp,
    ChevronDown,
    AudioLines,
    Subtitles,
    Maximize2,
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

    const [collapsed, setCollapsed] = useState(false);
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

    return (
        <div role="region" aria-label="Remote player">
            <div className="pointer-events-auto mx-auto max-w-lg px-4 pb-4">
                <div className="rounded-sm border border-border/50 bg-background/95 backdrop-blur-md shadow-lg overflow-hidden">
                    {/* Collapse toggle — title bar */}
                    <button
                        onClick={() => setCollapsed((c) => !c)}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? "Expand remote player" : "Collapse remote player"}
                        className="flex w-full items-center gap-2 px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors border-b border-border/30"
                    >
                        <DeviceTypeIcon type={targetDevice.deviceType} className="size-3.5 text-primary" />
                        <span className="flex-1 text-left truncate font-medium">
                            {nowPlaying ? nowPlaying.title : targetDevice.name}
                        </span>
                        <span className="text-muted-foreground/60 text-[9px] mr-1 hidden sm:inline">
                            {nowPlaying ? targetDevice.name : "Waiting for content"}
                        </span>
                        {collapsed ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    </button>

                    {/* ── Expanded: Full Remote ─────────────────────────── */}
                    {!collapsed && nowPlaying && (
                        <div className="px-4 pb-4 pt-3 space-y-4">
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
                                        background: `linear-gradient(to right, hsl(var(--primary)) ${progress}%, hsl(var(--muted)) ${progress}%)`,
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

                            {/* Transport controls — centered, larger */}
                            <div className="flex items-center justify-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-9 text-xs tabular-nums font-medium"
                                    onClick={() => cmd("seek", { position: Math.max(0, currentTime - 10) })}
                                    title="Rewind 10s"
                                    aria-label="Rewind 10 seconds"
                                >
                                    -10
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => cmd("previous")}
                                    title="Previous"
                                    aria-label="Previous"
                                >
                                    <SkipBack className="size-4 fill-current" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-11 rounded-full"
                                    onClick={() => cmd("toggle-pause")}
                                    title={isPlaying ? "Pause" : "Play"}
                                    aria-label={isPlaying ? "Pause" : "Play"}
                                >
                                    {isPlaying ? (
                                        <Pause className="size-5 fill-current" />
                                    ) : (
                                        <Play className="size-5 fill-current ml-0.5" />
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => cmd("next")}
                                    title="Next"
                                    aria-label="Next"
                                >
                                    <SkipForward className="size-4 fill-current" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-9 text-xs tabular-nums font-medium"
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
                                        background: `linear-gradient(to right, hsl(var(--primary)) ${volume}%, hsl(var(--muted)) ${volume}%)`,
                                    }}
                                />
                            </div>

                            {/* Playback queue */}
                            <PlaybackQueue compact />

                            {/* Bottom row: track selectors + fullscreen + stop */}
                            <div className="flex items-center justify-between border-t border-border/30 pt-3">
                                <div className="flex items-center gap-1">
                                    {/* Audio tracks */}
                                    {audioTracks.length > 1 && (
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
                                                    <DropdownMenuItem onClick={() => cmd("set-subtitle-track", { trackId: -1 })}>
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
                                    className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1.5"
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

                    {/* Idle state (selected but nothing playing) */}
                    {!collapsed && !nowPlaying && (
                        <div className="px-4 py-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Cast className="size-3.5 text-primary shrink-0" />
                                    <span className="text-xs text-muted-foreground truncate">
                                        Browse and play content — it will play on {targetDevice.name}
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs shrink-0"
                                    onClick={() => setActiveTarget(null)}
                                >
                                    Disconnect
                                </Button>
                            </div>
                            <RemoteFileBrowser targetDeviceId={targetDevice.id} />
                            <PlaybackQueue compact />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
