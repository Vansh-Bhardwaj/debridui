"use client";

import { memo, useCallback } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import type { DeviceInfo, TransferPayload, RemoteAction } from "@/lib/device-sync/protocol";
import {
    Monitor,
    Smartphone,
    Tablet,
    Tv,
    Volume2,
    Pause,
    Play,
    SkipForward,
    SkipBack,
    Cast,
    Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PairDialog } from "./pair-dialog";

// ── Device Icon Helper ─────────────────────────────────────────────────────

function DeviceIcon({ type, className }: { type: DeviceInfo["deviceType"]; className?: string }) {
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

// ── Device Row ─────────────────────────────────────────────────────────────

function DeviceRow({
    device,
    onTransfer,
    onCommand,
}: {
    device: DeviceInfo;
    onTransfer: (deviceId: string) => void;
    onCommand: (deviceId: string, action: RemoteAction) => void;
}) {
    const progressPercent =
        device.nowPlaying && device.nowPlaying.duration > 0
            ? Math.round((device.nowPlaying.progress / device.nowPlaying.duration) * 100)
            : 0;

    return (
        <div className="px-2 py-1.5">
            <div className="flex items-center gap-2">
                <DeviceIcon type={device.deviceType} className={device.isPlaying ? "text-primary" : "text-muted-foreground"} />
                <div className="flex-1 min-w-0">
                    <p className={cn("text-sm truncate", device.isPlaying && "text-primary font-medium")}>
                        {device.name}
                    </p>
                    {device.nowPlaying && (
                        <p className="text-xs text-muted-foreground truncate">
                            {device.nowPlaying.title}
                        </p>
                    )}
                </div>
                {device.isPlaying && (
                    <Volume2 className="size-3 text-primary animate-pulse" />
                )}
            </div>

            {/* Playback controls (visible when device is playing) */}
            {device.nowPlaying && (
                <div className="mt-1.5 space-y-1">
                    {/* Progress bar */}
                    <div className="h-1 w-full rounded-full bg-muted/50 overflow-hidden">
                        <div
                            className="h-full bg-primary/70 rounded-full transition-all"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>

                    {/* Controls */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-0.5">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={(e) => { e.stopPropagation(); onCommand(device.id, "previous"); }}
                            >
                                <SkipBack className="size-3" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={(e) => { e.stopPropagation(); onCommand(device.id, "toggle-pause"); }}
                            >
                                {device.nowPlaying.paused ? <Play className="size-3" /> : <Pause className="size-3" />}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={(e) => { e.stopPropagation(); onCommand(device.id, "next"); }}
                            >
                                <SkipForward className="size-3" />
                            </Button>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={(e) => { e.stopPropagation(); onTransfer(device.id); }}
                        >
                            Play here
                        </Button>
                    </div>
                </div>
            )}

            {/* Transfer button (visible when device is idle) */}
            {!device.nowPlaying && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-1 h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); onTransfer(device.id); }}
                >
                    <Cast className="size-3 mr-1" />
                    Play on this device
                </Button>
            )}
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────

export const DevicePicker = memo(function DevicePicker() {
    const devices = useDeviceSyncStore((s) => s.devices);
    const thisDevice = useDeviceSyncStore((s) => s.thisDevice);
    const connectionStatus = useDeviceSyncStore((s) => s.connectionStatus);
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const sendCommand = useDeviceSyncStore((s) => s.sendCommand);
    const transferPlayback = useDeviceSyncStore((s) => s.transferPlayback);

    const handleTransfer = useCallback(
        (targetDeviceId: string) => {
            // Get current playback state from video element or VLC
            const video = document.querySelector("video");
            if (video && video.src) {
                const payload: TransferPayload = {
                    url: video.src,
                    title: document.title || "Video",
                    progressSeconds: Math.round(video.currentTime),
                    durationSeconds: Math.round(video.duration || 0),
                };
                transferPlayback(targetDeviceId, payload);
            }
        },
        [transferPlayback]
    );

    const handleCommand = useCallback(
        (targetDeviceId: string, action: RemoteAction) => {
            sendCommand(targetDeviceId, action);
        },
        [sendCommand]
    );

    // Don't render if feature is disabled or no sync URL configured
    if (!enabled) return null;

    const isConnected = connectionStatus === "connected";
    const hasDevices = devices.length > 0;
    const playingDevice = devices.find((d) => d.isPlaying);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative size-8"
                    title={isConnected ? `${devices.length} device(s) online` : "Device sync"}
                >
                    <Cast className="size-4" />
                    {/* Online indicator dot */}
                    {isConnected && hasDevices && (
                        <span className={cn(
                            "absolute -top-0.5 -right-0.5 size-2 rounded-full",
                            playingDevice ? "bg-primary animate-pulse" : "bg-green-500"
                        )} />
                    )}
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground font-normal">
                    Devices
                </DropdownMenuLabel>

                {/* This device */}
                <DropdownMenuItem className="focus:bg-transparent cursor-default">
                    <div className="flex items-center gap-2">
                        <DeviceIcon type={thisDevice.deviceType} className="text-primary" />
                        <div>
                            <p className="text-sm font-medium text-primary">{thisDevice.name}</p>
                            <p className="text-xs text-muted-foreground">This device</p>
                        </div>
                    </div>
                </DropdownMenuItem>

                {/* Connection status */}
                {!isConnected && (
                    <DropdownMenuItem className="focus:bg-transparent cursor-default">
                        <p className="text-xs text-muted-foreground">
                            {connectionStatus === "connecting" ? "Connecting..." : "Disconnected"}
                        </p>
                    </DropdownMenuItem>
                )}

                {/* Other devices */}
                {hasDevices && (
                    <>
                        <DropdownMenuSeparator />
                        {devices.map((device) => (
                            <DeviceRow
                                key={device.id}
                                device={device}
                                onTransfer={handleTransfer}
                                onCommand={handleCommand}
                            />
                        ))}
                    </>
                )}

                {/* Empty state */}
                {isConnected && !hasDevices && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="focus:bg-transparent cursor-default">
                            <p className="text-xs text-muted-foreground text-center w-full py-1">
                                No other devices online
                            </p>
                        </DropdownMenuItem>
                    </>
                )}

                {/* Connect a new device */}
                {isConnected && (
                    <>
                        <DropdownMenuSeparator />
                        <PairDialog>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                <Link2 className="size-4 mr-2 text-muted-foreground" />
                                <span className="text-sm">Connect a device</span>
                            </DropdownMenuItem>
                        </PairDialog>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
});
