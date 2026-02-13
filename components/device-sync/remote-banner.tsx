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
    Cast,
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
 * Remote Control Banner — floating bar shown when:
 * 1. A remote device is selected as the active playback target
 * 2. Any remote device is actively playing content
 *
 * Spotify-style "Listening on [device]" banner with full controls.
 */
export const RemoteControlBanner = memo(function RemoteControlBanner() {
    const devices = useDeviceSyncStore((s) => s.devices);
    const activeTarget = useDeviceSyncStore((s) => s.activeTarget);
    const setActiveTarget = useDeviceSyncStore((s) => s.setActiveTarget);
    const sendCommand = useDeviceSyncStore((s) => s.sendCommand);
    const enabled = useDeviceSyncStore((s) => s.enabled);

    // Priority: show active target, otherwise first playing device
    const targetDevice = activeTarget
        ? devices.find((d) => d.id === activeTarget)
        : devices.find((d) => d.isPlaying && d.nowPlaying);

    const handleCommand = useCallback(
        (action: RemoteAction, payload?: Record<string, unknown>) => {
            if (!targetDevice) return;
            sendCommand(targetDevice.id, action, payload);
        },
        [targetDevice, sendCommand]
    );

    const handleSeek = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!targetDevice?.nowPlaying) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const position = ratio * targetDevice.nowPlaying.duration;
            handleCommand("seek", { position });
        },
        [targetDevice, handleCommand]
    );

    // Don't show if feature is off or no relevant device
    if (!enabled || !targetDevice) return null;

    const { nowPlaying } = targetDevice;
    const isPlaying = nowPlaying && !nowPlaying.paused;
    const progressPercent =
        nowPlaying && nowPlaying.duration > 0
            ? Math.min(100, (nowPlaying.progress / nowPlaying.duration) * 100)
            : 0;

    return (
        <div className="fixed bottom-0 inset-x-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {/* Seek bar (clickable, only when playing) */}
            {nowPlaying && (
                <div
                    className="h-1 w-full bg-muted/30 cursor-pointer group"
                    onClick={handleSeek}
                >
                    <div
                        className="h-full bg-primary transition-all group-hover:bg-primary/80"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            )}

            <div className="flex items-center gap-3 px-4 py-2 max-w-screen-xl mx-auto">
                {/* Device + now playing info */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <DeviceTypeIcon type={targetDevice.deviceType} className="text-primary shrink-0" />
                    <div className="min-w-0">
                        {nowPlaying ? (
                            <>
                                <p className="text-sm font-medium truncate">
                                    {nowPlaying.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Playing on {targetDevice.name} · {formatTime(nowPlaying.progress)} / {formatTime(nowPlaying.duration)}
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-sm font-medium truncate flex items-center gap-1.5">
                                    <Cast className="size-3.5 text-primary" />
                                    {targetDevice.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Selected as playback device · Browse and play content
                                </p>
                            </>
                        )}
                    </div>
                </div>

                {/* Playback controls (only when playing) */}
                {nowPlaying && (
                    <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => handleCommand("previous")}>
                            <SkipBack className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-9" onClick={() => handleCommand("toggle-pause")}>
                            {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => handleCommand("next")}>
                            <SkipForward className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => handleCommand("stop")} title="Stop">
                            <X className="size-4" />
                        </Button>
                    </div>
                )}

                {/* Switch back to local */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={() => {
                        if (nowPlaying) handleCommand("stop");
                        setActiveTarget(null);
                    }}
                >
                    <X className="size-3 mr-1" />
                    Disconnect
                </Button>
            </div>
        </div>
    );
});
