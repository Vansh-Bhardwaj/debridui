"use client";

import { memo, useCallback } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import type { DeviceInfo, RemoteAction } from "@/lib/device-sync/protocol";
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
    Check,
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

// ── Playback Controls (shown below the active target when it's playing) ───

function PlaybackControls({
    device,
    onCommand,
}: {
    device: DeviceInfo;
    onCommand: (deviceId: string, action: RemoteAction) => void;
}) {
    if (!device.nowPlaying) return null;

    const progressPercent =
        device.nowPlaying.duration > 0
            ? Math.round((device.nowPlaying.progress / device.nowPlaying.duration) * 100)
            : 0;

    return (
        // Prevent pointer/click events from propagating to Radix dropdown dismiss handler
        <div
            className="px-2 pb-1.5 space-y-1"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <p className="text-xs text-muted-foreground truncate px-0.5">
                {device.nowPlaying.title}
            </p>
            {/* Progress bar */}
            <div className="h-1 w-full rounded-full bg-muted/50 overflow-hidden">
                <div
                    className="h-full bg-primary/70 rounded-full transition-all"
                    style={{ width: `${progressPercent}%` }}
                />
            </div>
            {/* Controls */}
            <div className="flex items-center justify-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => onCommand(device.id, "previous")}
                >
                    <SkipBack className="size-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => onCommand(device.id, "toggle-pause")}
                >
                    {device.nowPlaying.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => onCommand(device.id, "next")}
                >
                    <SkipForward className="size-3.5" />
                </Button>
            </div>
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────

export const DevicePicker = memo(function DevicePicker() {
    const devices = useDeviceSyncStore((s) => s.devices);
    const thisDevice = useDeviceSyncStore((s) => s.thisDevice);
    const connectionStatus = useDeviceSyncStore((s) => s.connectionStatus);
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const activeTarget = useDeviceSyncStore((s) => s.activeTarget);
    const setActiveTarget = useDeviceSyncStore((s) => s.setActiveTarget);
    const sendCommand = useDeviceSyncStore((s) => s.sendCommand);

    const handleSelectDevice = useCallback(
        (deviceId: string | null) => {
            setActiveTarget(deviceId);
        },
        [setActiveTarget]
    );

    const handleCommand = useCallback(
        (targetDeviceId: string, action: RemoteAction) => {
            sendCommand(targetDeviceId, action);
        },
        [sendCommand]
    );

    if (!enabled) return null;

    const isConnected = connectionStatus === "connected";
    const hasDevices = devices.length > 0;
    const isRemoteActive = activeTarget !== null;
    const activeDevice = activeTarget ? devices.find((d) => d.id === activeTarget) : null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative size-8"
                    title={
                        isRemoteActive && activeDevice
                            ? `Playing on ${activeDevice.name}`
                            : isConnected
                              ? `${devices.length} device(s) online`
                              : "Device sync"
                    }
                >
                    <Cast className={cn("size-4", isRemoteActive && "text-primary")} />
                    {/* Indicator dot */}
                    {isConnected && (
                        <span className={cn(
                            "absolute -top-0.5 -right-0.5 size-2 rounded-full",
                            isRemoteActive ? "bg-primary animate-pulse" : hasDevices ? "bg-green-500" : "bg-muted-foreground/50"
                        )} />
                    )}
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground font-normal">
                    Play on
                </DropdownMenuLabel>

                {/* This device (always first, selectable) */}
                <DropdownMenuItem
                    onSelect={() => handleSelectDevice(null)}
                    className="cursor-pointer"
                >
                    <div className="flex items-center gap-2 flex-1">
                        <DeviceIcon type={thisDevice.deviceType} className={!isRemoteActive ? "text-primary" : "text-muted-foreground"} />
                        <div className="flex-1 min-w-0">
                            <p className={cn("text-sm truncate", !isRemoteActive && "text-primary font-medium")}>
                                {thisDevice.name}
                            </p>
                            <p className="text-xs text-muted-foreground">This device</p>
                        </div>
                        {!isRemoteActive && <Check className="size-4 text-primary shrink-0" />}
                    </div>
                </DropdownMenuItem>

                {/* Connection status */}
                {!isConnected && (
                    <DropdownMenuItem className="focus:bg-transparent cursor-default" onSelect={(e) => e.preventDefault()}>
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
                            <div key={device.id}>
                                <DropdownMenuItem
                                    onSelect={() => handleSelectDevice(device.id)}
                                    className="cursor-pointer"
                                >
                                    <div className="flex items-center gap-2 flex-1">
                                        <DeviceIcon
                                            type={device.deviceType}
                                            className={activeTarget === device.id ? "text-primary" : "text-muted-foreground"}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className={cn("text-sm truncate", activeTarget === device.id && "text-primary font-medium")}>
                                                {device.name}
                                            </p>
                                            {device.isPlaying && (
                                                <div className="flex items-center gap-1">
                                                    <Volume2 className="size-2.5 text-primary animate-pulse shrink-0" />
                                                    <p className="text-xs text-muted-foreground truncate">
                                                        {device.nowPlaying?.title}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                        {activeTarget === device.id && <Check className="size-4 text-primary shrink-0" />}
                                    </div>
                                </DropdownMenuItem>

                                {/* Show playback controls under the active target if it's playing */}
                                {activeTarget === device.id && device.nowPlaying && (
                                    <PlaybackControls device={device} onCommand={handleCommand} />
                                )}
                            </div>
                        ))}
                    </>
                )}

                {/* Empty state */}
                {isConnected && !hasDevices && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="focus:bg-transparent cursor-default" onSelect={(e) => e.preventDefault()}>
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
