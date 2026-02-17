"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useVLCStore, initVLCAutoDetect } from "@/lib/stores/vlc";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useUserAddons } from "@/hooks/use-addons";
import { useSettingsStore } from "@/lib/stores/settings";
import { MediaPlayer } from "@/lib/types";
import type { Addon } from "@/lib/addons/types";
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeX,
    Maximize2,
    X,
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
import { stopVLCProgressSync } from "@/lib/vlc-progress";

function formatTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const total = Math.floor(value);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const VLCMiniPlayer = memo(function VLCMiniPlayer() {
    const mediaPlayer = useSettingsStore((s) => s.settings.mediaPlayer);
    const isVLC = mediaPlayer === MediaPlayer.VLC;

    // Initialize auto-detection once
    const initialized = useRef(false);
    useEffect(() => {
        if (!initialized.current) {
            initialized.current = true;
            initVLCAutoDetect();
        }
    }, []);

    if (!isVLC) return null;
    return <VLCMiniPlayerInner />;
});

// ── Auto-next episode logic ───────────────────────────────────────────────

function useAutoNextEpisode() {
    const prevState = useRef<string | null>(null);
    const prevTime = useRef<number>(0);
    const prevLength = useRef<number>(0);
    const status = useVLCStore((s) => s.status);
    const episodeContext = useStreamingStore((s) => s.episodeContext);
    const playNextEpisode = useStreamingStore((s) => s.playNextEpisode);
    const autoNext = useSettingsStore((s) => s.settings.playback.autoNextEpisode);
    const { data: addons = [] } = useUserAddons();

    useEffect(() => {
        const currentState = status?.state ?? null;

        // Only auto-next on natural completion:
        // playing → stopped AND time was near end of stream (within 30s)
        const wasNearEnd = prevLength.current > 0 && prevTime.current >= prevLength.current - 30;
        if (
            autoNext &&
            episodeContext &&
            prevState.current === "playing" &&
            currentState === "stopped" &&
            wasNearEnd
        ) {
            stopVLCProgressSync();
            const enabledAddons = addons
                .filter((a: Addon) => a.enabled)
                .sort((a: Addon, b: Addon) => a.order - b.order)
                .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));
            if (enabledAddons.length > 0) {
                playNextEpisode(enabledAddons);
            }
        }

        prevState.current = currentState;
        prevTime.current = status?.time ?? 0;
        prevLength.current = status?.length ?? 0;
    }, [status?.state, status?.time, status?.length, autoNext, episodeContext, addons, playNextEpisode]);
}

// ── Inner component (only rendered when VLC is selected player) ───────────

const VLCMiniPlayerInner = memo(function VLCMiniPlayerInner() {
    const vlcConnected = useVLCStore((s) => s.vlcConnected);
    const status = useVLCStore((s) => s.status);
    const nowPlaying = useVLCStore((s) => s.nowPlaying);
    const togglePause = useVLCStore((s) => s.togglePause);
    const seek = useVLCStore((s) => s.seek);
    const setVolume = useVLCStore((s) => s.setVolume);
    const vlcStop = useVLCStore((s) => s.stop);
    const vlcFullscreen = useVLCStore((s) => s.fullscreen);
    const audioTracks = useVLCStore((s) => s.audioTracks);
    const subtitleTracks = useVLCStore((s) => s.subtitleTracks);
    const setAudioTrack = useVLCStore((s) => s.setAudioTrack);
    const setSubtitleTrack = useVLCStore((s) => s.setSubtitleTrack);
    const episodeContext = useStreamingStore((s) => s.episodeContext);
    const playNextEpisode = useStreamingStore((s) => s.playNextEpisode);
    const playPreviousEpisode = useStreamingStore((s) => s.playPreviousEpisode);
    const { data: addons = [] } = useUserAddons();

    const [collapsed, setCollapsed] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);

    const enabledAddons = addons
        .filter((a: Addon) => a.enabled)
        .sort((a: Addon, b: Addon) => a.order - b.order)
        .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));
    const hasEpisodes = !!episodeContext && enabledAddons.length > 0;

    // Auto-next episode when VLC finishes
    useAutoNextEpisode();

    // Listen for remote device-sync episode navigation commands
    useEffect(() => {
        if (!hasEpisodes) return;
        const handler = (e: Event) => {
            const direction = (e as CustomEvent).detail?.direction;
            if (direction === "next") playNextEpisode(enabledAddons);
            else if (direction === "previous") playPreviousEpisode(enabledAddons);
        };
        window.addEventListener("device-sync-navigate", handler);
        return () => window.removeEventListener("device-sync-navigate", handler);
    }, [hasEpisodes, enabledAddons, playNextEpisode, playPreviousEpisode]);

    const isPlaying = status?.state === "playing";
    const isPaused = status?.state === "paused";
    const currentTime = status?.time ?? 0;
    const duration = status?.length ?? 0;
    const volume = status ? Math.round((status.volume / 256) * 100) : 0;
    const isMuted = volume === 0;
    const isActive = isPlaying || isPaused;

    // Don't render if VLC has nothing playing 
    if (!vlcConnected || !isActive) return null;

    const displayTime = isSeeking ? seekValue : currentTime;
    const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

    return (
        <div role="region" aria-label="Media player" className="pointer-events-auto w-full max-w-3xl mx-auto px-4 pb-2">
            <div className="rounded-sm border border-border/50 bg-card/95 backdrop-blur-md shadow-xl overflow-hidden">
                    {/* Collapse toggle */}
                    <button
                        onClick={() => setCollapsed((c) => !c)}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? "Expand player" : "Collapse player"}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors border-b border-border/30"
                    >
                        <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
                        <span className="flex-1 text-left truncate font-medium">
                            {nowPlaying ?? "VLC"}
                        </span>
                        {collapsed ? (
                            <ChevronUp className="size-3" />
                        ) : (
                            <ChevronDown className="size-3" />
                        )}
                    </button>

                    {!collapsed && (
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
                                        seek(seekValue);
                                        setIsSeeking(false);
                                    }}
                                    onTouchEnd={() => {
                                        seek(seekValue);
                                        setIsSeeking(false);
                                    }}
                                    onKeyUp={(e) => {
                                        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                                            seek(Number((e.target as HTMLInputElement).value));
                                            setIsSeeking(false);
                                        }
                                    }}
                                    className="flex-1 h-1 cursor-pointer appearance-none rounded-full accent-primary"
                                    style={{
                                        background: `linear-gradient(to right, var(--primary) ${progress}%, var(--muted) ${progress}%)`,
                                    }}
                                />
                                <span className="text-[10px] tabular-nums text-muted-foreground w-10">
                                    {formatTime(duration)}
                                </span>
                            </div>

                            {/* Controls */}
                            <div className="flex flex-wrap items-center justify-between gap-y-1">
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-xs tabular-nums font-medium"
                                        onClick={() => seek(Math.max(0, currentTime - 10))}
                                        title="Rewind 10s"
                                        aria-label="Rewind 10 seconds"
                                    >
                                        -10
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9"
                                        onClick={() => togglePause()}
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
                                        onClick={() => seek(Math.min(duration, currentTime + 10))}
                                        title="Forward 10s"
                                        aria-label="Forward 10 seconds"
                                    >
                                        +10
                                    </Button>
                                </div>

                                {/* Volume */}
                                <div className="flex items-center gap-1 group/vol">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setVolume(isMuted ? 256 : 0)}
                                        title={isMuted ? "Unmute" : "Mute"}
                                        aria-label={isMuted ? "Unmute" : "Mute"}
                                    >
                                        {isMuted ? (
                                            <VolumeX className="size-4" />
                                        ) : (
                                            <Volume2 className="size-4" />
                                        )}
                                    </Button>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={volume}
                                        aria-label="Volume"
                                        onChange={(e) => {
                                            const pct = Number(e.target.value);
                                            setVolume(Math.round((pct / 100) * 256));
                                        }}
                                        className="w-14 sm:w-0 sm:overflow-hidden accent-primary transition-all duration-300 sm:group-hover/vol:w-16"
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
                                                        <DropdownMenuItem key={t.id} onClick={() => setAudioTrack(t.id)}>
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
                                                    <DropdownMenuItem onClick={() => setSubtitleTrack(-1)}>
                                                        Off
                                                    </DropdownMenuItem>
                                                    {subtitleTracks.map((t) => (
                                                        <DropdownMenuItem key={t.id} onClick={() => setSubtitleTrack(t.id)}>
                                                            {t.name}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}
                                </div>

                                {/* Right actions */}
                                <div className="flex items-center gap-1">
                                    {hasEpisodes && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => playPreviousEpisode(enabledAddons)}
                                                title="Previous Episode"
                                                aria-label="Previous Episode"
                                            >
                                                <SkipBack className="size-3.5 fill-current" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => playNextEpisode(enabledAddons)}
                                                title="Next Episode"
                                                aria-label="Next Episode"
                                            >
                                                <SkipForward className="size-3.5 fill-current" />
                                            </Button>
                                        </>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => vlcFullscreen()}
                                        title="VLC Fullscreen"
                                        aria-label="Fullscreen"
                                    >
                                        <Maximize2 className="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => {
                                            vlcStop();
                                            stopVLCProgressSync();
                                        }}
                                        title="Stop"
                                        aria-label="Stop playback"
                                    >
                                        <X className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
    );
});
