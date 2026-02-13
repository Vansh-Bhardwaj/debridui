"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DeviceSyncClient } from "@/lib/device-sync/client";
import { detectDevice } from "@/lib/device-sync/protocol";
import type { ServerMessage, TransferPayload, TrackInfo, QueueItem } from "@/lib/device-sync/protocol";
import {
    Monitor,
    Smartphone,
    Tablet,
    Tv,
    Pause,
    Play,
    SkipForward,
    SkipBack,
    X,
    Volume2,
    VolumeX,
    Check,
    AudioLines,
    Subtitles,
    Maximize2,
    ListMusic,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DeviceInfo, RemoteAction } from "@/lib/device-sync/protocol";
import { cn } from "@/lib/utils";

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
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        }>
            <PairPageContent />
        </Suspense>
    );
}

function PairPageContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const syncUrl = process.env.NEXT_PUBLIC_DEVICE_SYNC_URL;
    const isValid = !!token && !!syncUrl;

    const [state, setState] = useState<ConnectionState>(isValid ? "connecting" : "invalid");
    const [devices, setDevices] = useState<DeviceInfo[]>([]);
    const [, setPlayback] = useState<TransferPayload | null>(null);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
    const [queue, setQueue] = useState<QueueItem[]>([]);
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
                setSelectedDeviceId((prev) => prev === msg.deviceId ? null : prev);
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
                if (msg.playback.url) {
                    window.open(msg.playback.url, "_blank");
                }
                break;
            case "queue-updated":
                setQueue(msg.queue);
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
                if (status === "connected") {
                    setState("connected");
                    // Request current queue
                    client.send({ type: "queue-get" });
                }
            },
        });

        clientRef.current = client;
        client.connect().then(() => {
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

    // Auto-select the first device if only one is online
    const effectiveSelectedId = selectedDeviceId ?? (devices.length === 1 ? devices[0].id : null);

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

    const selectedDevice = effectiveSelectedId ? devices.find((d) => d.id === effectiveSelectedId) : null;

    return (
        <div className="min-h-screen bg-background p-4">
            <div className="mx-auto max-w-lg space-y-6 pt-8">
                {/* Header */}
                <div className="text-center space-y-1 animate-in fade-in-0 slide-in-from-bottom-4" style={{ animationDuration: "600ms" }}>
                    <h1 className="text-2xl font-light">DebridUI Remote</h1>
                    <p className="text-xs tracking-widest uppercase text-muted-foreground">
                        Connected · {devices.length} device{devices.length !== 1 ? "s" : ""} online
                    </p>
                </div>

                {/* Full remote controller for selected device */}
                {selectedDevice && (
                    <RemoteController
                        device={selectedDevice}
                        onCommand={(action, payload) => sendCommand(selectedDevice.id, action, payload)}
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
                            <button
                                key={device.id}
                                onClick={() => setSelectedDeviceId(device.id)}
                                className={cn(
                                    "flex items-center gap-3 rounded-sm border p-3 w-full text-left transition-colors",
                                    effectiveSelectedId === device.id
                                        ? "border-primary/50 bg-primary/5"
                                        : "border-border/50 hover:bg-muted/30"
                                )}
                            >
                                <DeviceTypeIcon
                                    type={device.deviceType}
                                    className={cn(
                                        "size-5",
                                        effectiveSelectedId === device.id ? "text-primary" : device.isPlaying ? "text-primary" : "text-muted-foreground"
                                    )}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className={cn(
                                        "text-sm truncate",
                                        effectiveSelectedId === device.id && "font-medium text-primary"
                                    )}>
                                        {device.name}
                                    </p>
                                    {device.nowPlaying && (
                                        <p className="text-xs text-muted-foreground truncate">
                                            {device.nowPlaying.title}
                                        </p>
                                    )}
                                </div>
                                {effectiveSelectedId === device.id ? (
                                    <Check className="size-4 text-primary shrink-0" />
                                ) : device.isPlaying ? (
                                    <Volume2 className="size-3 text-primary animate-pulse shrink-0" />
                                ) : null}
                            </button>
                        ))
                    )}
                </div>

                {/* Playback Queue */}
                {queue.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-1.5">
                                <ListMusic className="size-3.5 text-muted-foreground" />
                                <p className="text-xs tracking-widest uppercase text-muted-foreground">
                                    Queue · {queue.length}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] text-muted-foreground hover:text-destructive gap-1"
                                onClick={() => clientRef.current?.send({ type: "queue-clear" })}
                            >
                                <Trash2 className="size-3" />
                                Clear
                            </Button>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                            {queue.map((item, i) => (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 group hover:bg-muted/30 transition-colors"
                                >
                                    <span className="text-[10px] text-muted-foreground w-4 text-center shrink-0">
                                        {i + 1}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs truncate">{item.title}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {item.addedBy}
                                            {item.mediaType === "show" && item.season && item.episode && (
                                                <> <span className="text-border">·</span> S{String(item.season).padStart(2, "0")}E{String(item.episode).padStart(2, "0")}</>
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                        {effectiveSelectedId && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-6"
                                                onClick={() => {
                                                    if (effectiveSelectedId) {
                                                        sendCommand(effectiveSelectedId, "stop");
                                                        clientRef.current?.transferTo(effectiveSelectedId, {
                                                            url: item.url,
                                                            title: item.title,
                                                            imdbId: item.imdbId,
                                                            mediaType: item.mediaType,
                                                            season: item.season,
                                                            episode: item.episode,
                                                            subtitles: item.subtitles,
                                                        });
                                                    }
                                                    clientRef.current?.send({ type: "queue-remove", itemId: item.id });
                                                }}
                                                title="Play now"
                                            >
                                                <Play className="size-3 fill-current" />
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-6 text-muted-foreground hover:text-destructive"
                                            onClick={() => clientRef.current?.send({ type: "queue-remove", itemId: item.id })}
                                            title="Remove"
                                        >
                                            <X className="size-3" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Full Remote Controller ─────────────────────────────────────────────────

function RemoteController({
    device,
    onCommand,
}: {
    device: DeviceInfo;
    onCommand: (action: RemoteAction, payload?: Record<string, unknown>) => void;
}) {
    const nowPlaying = device.nowPlaying;
    const [seekActive, setSeekActive] = useState(false);
    const [seekValue, setSeekValue] = useState(0);
    const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const commitSeek = useCallback(
        (position: number) => {
            onCommand("seek", { position });
            if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
            seekTimeoutRef.current = setTimeout(() => setSeekActive(false), 3000);
        },
        [onCommand],
    );

    if (!nowPlaying) {
        return (
            <div className="rounded-sm border border-border/50 p-6 text-center space-y-2">
                <DeviceTypeIcon type={device.deviceType} className="size-6 text-primary mx-auto" />
                <p className="text-sm font-medium">{device.name}</p>
                <p className="text-xs text-muted-foreground">Nothing is playing on this device</p>
            </div>
        );
    }

    const isPlaying = !nowPlaying.paused;
    const currentTime = nowPlaying.progress;
    const duration = nowPlaying.duration;
    const displayTime = seekActive ? seekValue : currentTime;
    const progress = duration > 0 ? (displayTime / duration) * 100 : 0;
    const volume = nowPlaying.volume ?? 100;
    const isMuted = volume === 0;
    const audioTracks = nowPlaying.audioTracks ?? [];
    const subtitleTracks = nowPlaying.subtitleTracks ?? [];

    return (
        <div className="rounded-sm border border-border/50 overflow-hidden">
            <div className="p-5 space-y-5">
                {/* Device + title */}
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <DeviceTypeIcon type={device.deviceType} className="size-3.5 text-primary" />
                        <span>Playing on {device.name}</span>
                    </div>
                    <p className="text-lg font-light truncate">{nowPlaying.title}</p>
                    {nowPlaying.type === "show" && nowPlaying.season && nowPlaying.episode && (
                        <p className="text-xs text-muted-foreground">
                            Season {nowPlaying.season} <span className="text-border">·</span> Episode {nowPlaying.episode}
                        </p>
                    )}
                </div>

                {/* Seek bar */}
                <div className="space-y-1.5">
                    <input
                        type="range"
                        min={0}
                        max={duration > 0 ? duration : 0}
                        step={1}
                        value={displayTime}
                        aria-label="Seek"
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
                        <span className="text-[10px] tabular-nums text-muted-foreground">{formatTime(displayTime)}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Transport controls */}
                <div className="flex items-center justify-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-10 text-sm tabular-nums font-medium"
                        onClick={() => onCommand("seek", { position: Math.max(0, currentTime - 10) })}
                        title="Rewind 10s"
                        aria-label="Rewind 10 seconds"
                    >
                        -10
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        onClick={() => onCommand("previous")}
                        title="Previous"
                        aria-label="Previous"
                    >
                        <SkipBack className="size-5 fill-current" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="size-14 rounded-full"
                        onClick={() => onCommand("toggle-pause")}
                        title={isPlaying ? "Pause" : "Play"}
                        aria-label={isPlaying ? "Pause" : "Play"}
                    >
                        {isPlaying ? (
                            <Pause className="size-6 fill-current" />
                        ) : (
                            <Play className="size-6 fill-current ml-0.5" />
                        )}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        onClick={() => onCommand("next")}
                        title="Next"
                        aria-label="Next"
                    >
                        <SkipForward className="size-5 fill-current" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-10 text-sm tabular-nums font-medium"
                        onClick={() => onCommand("seek", { position: Math.min(duration, currentTime + 10) })}
                        title="Forward 10s"
                        aria-label="Forward 10 seconds"
                    >
                        +10
                    </Button>
                </div>

                {/* Volume slider */}
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        onClick={() => onCommand("volume", { level: isMuted ? 1 : 0 })}
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
                        onChange={(e) => onCommand("volume", { level: Number(e.target.value) / 100 })}
                        className="flex-1 h-1 cursor-pointer appearance-none rounded-full accent-primary"
                        style={{
                            background: `linear-gradient(to right, hsl(var(--primary)) ${volume}%, hsl(var(--muted)) ${volume}%)`,
                        }}
                    />
                </div>

                {/* Bottom row: tracks + fullscreen + stop */}
                <div className="flex items-center justify-between border-t border-border/30 pt-4">
                    <div className="flex items-center gap-1">
                        <TrackDropdown
                            icon={<AudioLines className="size-3.5" />}
                            label="Audio"
                            tracks={audioTracks}
                            onSelect={(id) => onCommand("set-audio-track", { trackId: id })}
                            showOff={false}
                        />
                        <TrackDropdown
                            icon={<Subtitles className="size-3.5" />}
                            label="Subtitles"
                            tracks={subtitleTracks}
                            onSelect={(id) => onCommand("set-subtitle-track", { trackId: id })}
                            showOff={true}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => onCommand("fullscreen")}
                            title="Fullscreen"
                        >
                            <Maximize2 className="size-3.5" />
                        </Button>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1.5"
                        onClick={() => onCommand("stop")}
                        title="Stop"
                    >
                        <X className="size-3.5" />
                        Stop
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ── Track Dropdown ─────────────────────────────────────────────────────────

function TrackDropdown({
    icon,
    label,
    tracks,
    onSelect,
    showOff,
}: {
    icon: React.ReactNode;
    label: string;
    tracks: TrackInfo[];
    onSelect: (id: number) => void;
    showOff: boolean;
}) {
    if (tracks.length === 0) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
                    {icon}
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
                <DropdownMenuContent align="start" side="top" className="max-h-48 overflow-y-auto">
                    {showOff && (
                        <DropdownMenuItem onClick={() => onSelect(-1)}>Off</DropdownMenuItem>
                    )}
                    {tracks.map((t) => (
                        <DropdownMenuItem
                            key={t.id}
                            onClick={() => onSelect(t.id)}
                            className={cn(t.active && "text-primary font-medium")}
                        >
                            {t.name}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenu>
    );
}
