"use client";

import { memo, useCallback } from "react";
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
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
 * Remote Control Banner — floating bar shown when another device is playing.
 *
 * Displays now-playing info and basic controls (play/pause/seek/skip)
 * similar to Spotify's "Listening on [device]" banner.
 */
export const RemoteControlBanner = memo(function RemoteControlBanner() {
    const devices = useDeviceSyncStore((s) => s.devices);
    const sendCommand = useDeviceSyncStore((s) => s.sendCommand);
    const enabled = useDeviceSyncStore((s) => s.enabled);

    // Find the first device that's actively playing
    const playingDevice = devices.find((d) => d.isPlaying && d.nowPlaying);

    const handleCommand = useCallback(
        (action: RemoteAction, payload?: Record<string, unknown>) => {
            if (!playingDevice) return;
            sendCommand(playingDevice.id, action, payload);
        },
        [playingDevice, sendCommand]
    );

    const handleSeek = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!playingDevice?.nowPlaying) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const position = ratio * playingDevice.nowPlaying.duration;
            handleCommand("seek", { position });
        },
        [playingDevice, handleCommand]
    );

    if (!enabled || !playingDevice?.nowPlaying) return null;

    const { nowPlaying } = playingDevice;
    const progressPercent =
        nowPlaying.duration > 0
            ? Math.min(100, (nowPlaying.progress / nowPlaying.duration) * 100)
            : 0;

    return (
        <div className="fixed bottom-0 inset-x-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {/* Seek bar (clickable) */}
            <div
                className="h-1 w-full bg-muted/30 cursor-pointer group"
                onClick={handleSeek}
            >
                <div
                    className="h-full bg-primary transition-all group-hover:bg-primary/80"
                    style={{ width: `${progressPercent}%` }}
                />
            </div>

            <div className="flex items-center gap-3 px-4 py-2 max-w-screen-xl mx-auto">
                {/* Device + now playing info */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <DeviceTypeIcon type={playingDevice.deviceType} className="text-primary shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                            {nowPlaying.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Playing on {playingDevice.name} · {formatTime(nowPlaying.progress)} / {formatTime(nowPlaying.duration)}
                        </p>
                    </div>
                </div>

                {/* Playback controls */}
                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleCommand("previous")}
                    >
                        <SkipBack className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        onClick={() => handleCommand("toggle-pause")}
                    >
                        {nowPlaying.paused ? (
                            <Play className="size-5" />
                        ) : (
                            <Pause className="size-5" />
                        )}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleCommand("next")}
                    >
                        <SkipForward className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleCommand("stop")}
                        title="Stop"
                    >
                        <X className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
});
