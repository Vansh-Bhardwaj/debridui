"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { DeviceSyncClient } from "@/lib/device-sync/client";
import { detectDevice } from "@/lib/device-sync/protocol";
import type { ServerMessage, NowPlayingInfo, TransferPayload } from "@/lib/device-sync/protocol";
import { Monitor, Smartphone, Tablet, Tv, Pause, Play, SkipForward, SkipBack, X, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeviceInfo, RemoteAction } from "@/lib/device-sync/protocol";

function DeviceTypeIcon({ type, className }: { type: DeviceInfo["deviceType"]; className?: string }) {
    switch (type) {
        case "mobile": return <Smartphone className={className} />;
        case "tablet": return <Tablet className={className} />;
        case "tv": return <Tv className={className} />;
        default: return <Monitor className={className} />;
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

type ConnectionState = "connecting" | "connected" | "error" | "invalid";

export default function PairPage() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const syncUrl = process.env.NEXT_PUBLIC_DEVICE_SYNC_URL;
    const isValid = !!token && !!syncUrl;

    const [state, setState] = useState<ConnectionState>(isValid ? "connecting" : "invalid");
    const [devices, setDevices] = useState<DeviceInfo[]>([]);
    const [_playback, setPlayback] = useState<TransferPayload | null>(null);
    const clientRef = useRef<DeviceSyncClient | null>(null);

    const handleMessage = useCallback((msg: ServerMessage) => {
        const selfId = detectDevice().id;
        switch (msg.type) {
            case "devices":
                setDevices(msg.devices.filter((d) => d.id !== selfId));
                break;
            case "device-joined":
                if (msg.device.id !== selfId) {
                    setDevices((prev) => [...prev.filter((d) => d.id !== msg.device.id), msg.device]);
                }
                break;
            case "device-left":
                setDevices((prev) => prev.filter((d) => d.id !== msg.deviceId));
                break;
            case "now-playing-update":
                setDevices((prev) =>
                    prev.map((d) =>
                        d.id === msg.deviceId
                            ? { ...d, nowPlaying: msg.state, isPlaying: msg.state !== null && !msg.state.paused }
                            : d
                    )
                );
                break;
            case "transfer":
                setPlayback(msg.playback);
                // Open the transferred URL in a new tab or in the current page
                if (msg.playback.url) {
                    window.open(msg.playback.url, "_blank");
                }
                break;
        }
    }, []);

    useEffect(() => {
        if (!isValid || !token || !syncUrl) return;

        const client = new DeviceSyncClient({
            syncUrl,
            getToken: async () => token,
            onMessage: handleMessage,
            onStatusChange: (status) => {
                if (status === "connected") setState("connected");
            },
        });

        clientRef.current = client;
        client.connect().then(() => {
            // If still connecting after 10s, show error
            setTimeout(() => {
                if (client.status !== "connected") setState("error");
            }, 10000);
        });

        return () => {
            client.disconnect();
            clientRef.current = null;
        };
    }, [token, syncUrl, handleMessage, isValid]);

    const sendCommand = useCallback((targetId: string, action: RemoteAction, payload?: Record<string, unknown>) => {
        clientRef.current?.sendCommand(targetId, action, payload);
    }, []);

    if (state === "invalid") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <div className="text-center space-y-3 max-w-md">
                    <h1 className="text-2xl font-light">Invalid Pairing Link</h1>
                    <p className="text-sm text-muted-foreground">
                        This link is invalid or has expired. Generate a new one from the device picker
                        in DebridUI.
                    </p>
                </div>
            </div>
        );
    }

    if (state === "connecting") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <div className="text-center space-y-3">
                    <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-muted-foreground">Connecting to your session...</p>
                </div>
            </div>
        );
    }

    if (state === "error") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <div className="text-center space-y-3 max-w-md">
                    <h1 className="text-2xl font-light">Connection Failed</h1>
                    <p className="text-sm text-muted-foreground">
                        Couldn&#39;t connect to the sync server. The link may have expired, or the sync
                        worker isn&#39;t configured.
                    </p>
                    <Button onClick={() => window.location.reload()} variant="outline" size="sm">
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    const playingDevice = devices.find((d) => d.isPlaying && d.nowPlaying);

    return (
        <div className="min-h-screen bg-background p-4">
            <div className="mx-auto max-w-lg space-y-6 pt-8">
                <div className="text-center space-y-1">
                    <h1 className="text-2xl font-light">DebridUI Remote</h1>
                    <p className="text-xs tracking-widest uppercase text-muted-foreground">
                        Connected · {devices.length} device{devices.length !== 1 ? "s" : ""} online
                    </p>
                </div>

                {/* Now playing card */}
                {playingDevice?.nowPlaying && (
                    <NowPlayingCard
                        device={playingDevice}
                        nowPlaying={playingDevice.nowPlaying}
                        onCommand={(action, payload) => sendCommand(playingDevice.id, action, payload)}
                    />
                )}

                {/* Device list */}
                <div className="space-y-2">
                    <p className="text-xs tracking-widest uppercase text-muted-foreground px-1">
                        Devices
                    </p>
                    {devices.length === 0 ? (
                        <div className="rounded-sm border border-border/50 p-6 text-center">
                            <p className="text-sm text-muted-foreground">
                                No other devices online. Open DebridUI on another device.
                            </p>
                        </div>
                    ) : (
                        devices.map((device) => (
                            <div
                                key={device.id}
                                className="flex items-center gap-3 rounded-sm border border-border/50 p-3"
                            >
                                <DeviceTypeIcon
                                    type={device.deviceType}
                                    className={`size-5 ${device.isPlaying ? "text-primary" : "text-muted-foreground"}`}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{device.name}</p>
                                    {device.nowPlaying && (
                                        <p className="text-xs text-muted-foreground truncate">
                                            {device.nowPlaying.title}
                                        </p>
                                    )}
                                </div>
                                {device.isPlaying && (
                                    <Volume2 className="size-3 text-primary animate-pulse shrink-0" />
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function NowPlayingCard({
    device,
    nowPlaying,
    onCommand,
}: {
    device: DeviceInfo;
    nowPlaying: NowPlayingInfo;
    onCommand: (action: RemoteAction, payload?: Record<string, unknown>) => void;
}) {
    const progressPercent =
        nowPlaying.duration > 0
            ? Math.min(100, (nowPlaying.progress / nowPlaying.duration) * 100)
            : 0;

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onCommand("seek", { position: ratio * nowPlaying.duration });
    };

    return (
        <div className="rounded-sm border border-border/50 overflow-hidden">
            <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <DeviceTypeIcon type={device.deviceType} className="size-3.5 text-primary" />
                    <span>Playing on {device.name}</span>
                </div>

                <p className="text-lg font-light truncate">{nowPlaying.title}</p>

                {/* Seek bar */}
                <div
                    className="h-1.5 w-full rounded-full bg-muted/30 cursor-pointer group"
                    onClick={handleSeek}
                >
                    <div
                        className="h-full bg-primary rounded-full transition-all group-hover:bg-primary/80"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatTime(nowPlaying.progress)}</span>
                    <span>{formatTime(nowPlaying.duration)}</span>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        onClick={() => onCommand("previous")}
                    >
                        <SkipBack className="size-5" />
                    </Button>
                    <Button
                        variant="default"
                        size="icon"
                        className="size-12 rounded-full"
                        onClick={() => onCommand("toggle-pause")}
                    >
                        {nowPlaying.paused ? (
                            <Play className="size-6 ml-0.5" />
                        ) : (
                            <Pause className="size-6" />
                        )}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        onClick={() => onCommand("next")}
                    >
                        <SkipForward className="size-5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        onClick={() => onCommand("stop")}
                    >
                        <X className="size-5" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
