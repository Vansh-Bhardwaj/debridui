"use client";

import { memo, useCallback, useState } from "react";
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
 * Remote Control Banner — full-featured controller matching VLC mini player.
 *
 * Shows when:
 * 1. A remote device is selected as the active playback target
 * 2. Any remote device is actively playing content
 *
 * Features: seek bar, ±10s, play/pause, skip, volume, audio/subtitle tracks,
 * episode navigation, disconnect — all following the editorial minimalism design.
 */
export const RemoteControlBanner = memo(function RemoteControlBanner() {
    const devices = useDeviceSyncStore((s) => s.devices);
    const activeTarget = useDeviceSyncStore((s) => s.activeTarget);
    const setActiveTarget = useDeviceSyncStore((s) => s.setActiveTarget);
    const sendCommand = useDeviceSyncStore((s) => s.sendCommand);
    const enabled = useDeviceSyncStore((s) => s.enabled);

    const [collapsed, setCollapsed] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);

    // Priority: show active target, otherwise first playing device
    const targetDevice = activeTarget
        ? devices.find((d) => d.id === activeTarget)
        : devices.find((d) => d.isPlaying && d.nowPlaying);

    const cmd = useCallback(
        (action: RemoteAction, payload?: Record<string, unknown>) => {
            if (!targetDevice) return;
            sendCommand(targetDevice.id, action, payload);
        },
        [targetDevice, sendCommand]
    );

    if (!enabled || !targetDevice) return null;

    const { nowPlaying } = targetDevice;
    const isPlaying = nowPlaying && !nowPlaying.paused;
    const currentTime = nowPlaying?.progress ?? 0;
    const duration = nowPlaying?.duration ?? 0;
    const displayTime = isSeeking ? seekValue : currentTime;
    const progress = duration > 0 ? (displayTime / duration) * 100 : 0;
    const volume = nowPlaying?.volume ?? 100;
    const isMuted = volume === 0;
    const audioTracks = nowPlaying?.audioTracks ?? [];
    const subtitleTracks = nowPlaying?.subtitleTracks ?? [];

    return (
        <div className="fixed bottom-0 inset-x-0 z-50 pointer-events-none" role="region" aria-label="Remote player">
            <div className="pointer-events-auto mx-auto max-w-3xl px-4 pb-4">
                <div className="rounded-sm border border-border/50 bg-background/95 backdrop-blur-md shadow-lg overflow-hidden">
                    {/* Collapse toggle — title bar */}
                    <button
                        onClick={() => setCollapsed((c) => !c)}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? "Expand remote player" : "Collapse remote player"}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors border-b border-border/30"
                    >
                        <DeviceTypeIcon type={targetDevice.deviceType} className="size-3 text-primary" />
                        <span className="flex-1 text-left truncate font-medium">
                            {nowPlaying ? nowPlaying.title : targetDevice.name}
                        </span>
                        <span className="text-muted-foreground/60 text-[9px] mr-1">
                            {nowPlaying
                                ? `${targetDevice.name}`
                                : "Waiting for content"}
                        </span>
                        {collapsed ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    </button>

                    {!collapsed && nowPlaying && (
                        <div className="px-3 pb-3 pt-2 space-y-2">
                            {/* Seek bar */}
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] tabular-nums text-muted-foreground w-10 text-right">
                                    {formatTime(displayTime)}
                                </span>
                                <input
                                    type="range"
                                    min={0}
                                    max={duration > 0 ? duration : 0}
                                    step={1}
                                    value={displayTime}
                                    aria-label="Seek"
                                    aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
                                    onChange={(e) => {
                                        setIsSeeking(true);
                                        setSeekValue(Number(e.target.value));
                                    }}
                                    onMouseUp={() => {
                                        cmd("seek", { position: seekValue });
                                        setIsSeeking(false);
                                    }}
                                    onTouchEnd={() => {
                                        cmd("seek", { position: seekValue });
                                        setIsSeeking(false);
                                    }}
                                    className="flex-1 h-1 cursor-pointer appearance-none rounded-full accent-primary"
                                    style={{
                                        background: `linear-gradient(to right, hsl(var(--primary)) ${progress}%, hsl(var(--muted)) ${progress}%)`,
                                    }}
                                />
                                <span className="text-[10px] tabular-nums text-muted-foreground w-10">
                                    {formatTime(duration)}
                                </span>
                            </div>

                            {/* Controls row */}
                            <div className="flex items-center justify-between gap-1 flex-wrap">
                                {/* Transport controls */}
                                <div className="flex items-center gap-0.5">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-xs tabular-nums font-medium"
                                        onClick={() => cmd("seek", { position: Math.max(0, currentTime - 10) })}
                                        title="Rewind 10s"
                                        aria-label="Rewind 10 seconds"
                                    >
                                        -10
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9"
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
                                        className="h-8 w-8 text-xs tabular-nums font-medium"
                                        onClick={() => cmd("seek", { position: Math.min(duration, currentTime + 10) })}
                                        title="Forward 10s"
                                        aria-label="Forward 10 seconds"
                                    >
                                        +10
                                    </Button>
                                </div>

                                {/* Volume */}
                                <div className="flex items-center gap-0.5 group/vol">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
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
                                        onChange={(e) => {
                                            cmd("volume", { level: Number(e.target.value) / 100 });
                                        }}
                                        className="w-0 overflow-hidden accent-primary transition-all duration-300 group-hover/vol:w-16"
                                    />
                                </div>

                                {/* Track selectors */}
                                <div className="flex items-center gap-0.5">
                                    {audioTracks.length > 1 && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Audio Track" aria-label="Audio Track">
                                                    <AudioLines className="size-3.5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal>
                                                <DropdownMenuContent align="center" side="top">
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
                                    {subtitleTracks.length > 0 && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Subtitle Track" aria-label="Subtitle Track">
                                                    <Subtitles className="size-3.5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal>
                                                <DropdownMenuContent align="center" side="top">
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
                                </div>

                                {/* Episode nav + actions */}
                                <div className="flex items-center gap-0.5">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => cmd("previous")}
                                        title="Previous Episode"
                                        aria-label="Previous Episode"
                                    >
                                        <SkipBack className="size-3.5 fill-current" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => cmd("next")}
                                        title="Next Episode"
                                        aria-label="Next Episode"
                                    >
                                        <SkipForward className="size-3.5 fill-current" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => {
                                            cmd("stop");
                                            setActiveTarget(null);
                                        }}
                                        title="Stop & Disconnect"
                                        aria-label="Stop and disconnect"
                                    >
                                        <X className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Idle state (selected but nothing playing) */}
                    {!collapsed && !nowPlaying && (
                        <div className="flex items-center justify-between px-3 py-2">
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
                    )}
                </div>
            </div>
        </div>
    );
});
