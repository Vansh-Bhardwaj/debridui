"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    Link2,
    Monitor,
    RefreshCw,
    Smartphone,
    XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionDivider } from "@/components/common/section-divider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { detectCodecSupport, isIOS, isSafari, type CodecSupport } from "@/lib/utils/codec-support";
import { useVLCStore } from "@/lib/stores/vlc";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import { useSettingsStore } from "@/lib/stores/settings";
import { MediaPlayer } from "@/lib/types";
import { isMobileOrTablet } from "@/lib/utils/media-player";
import type { CheckStatus, HealthResponse } from "@/lib/health";
import { ErrorState, LoadingState } from "@/components/common/async-state";
import { fetchWithTimeout } from "@/lib/utils/error-handling";
import { useUserSettings } from "@/hooks/use-user-settings";

type StatusMeta = {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    Icon: typeof CheckCircle2;
};

const STATUS_META: Record<CheckStatus, StatusMeta> = {
    ok: { label: "Operational", variant: "default", Icon: CheckCircle2 },
    degraded: { label: "Degraded", variant: "secondary", Icon: AlertTriangle },
    error: { label: "Down", variant: "destructive", Icon: XCircle },
};

const REFRESH_OPTIONS = [
    { label: "Off", value: "0" },
    { label: "1 min", value: "60000" },
    { label: "5 min", value: "300000" },
    { label: "15 min", value: "900000" },
];

const formatValue = (value: string | number | boolean | undefined) => {
    if (value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
};

const formatList = (items: string[] | undefined) => {
    if (!items || items.length === 0) return "None";
    return items.join(", ");
};

function StatusBadge({ status }: { status: CheckStatus }) {
    const meta = STATUS_META[status];
    const Icon = meta.Icon;
    return (
        <Badge variant={meta.variant}>
            <Icon className="size-3.5" />
            {meta.label}
        </Badge>
    );
}

function KeyValue({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground text-right truncate max-w-[60%]">{value}</span>
        </div>
    );
}

// — Inline service status row for overview card
function ServiceRow({ label, status }: { label: string; status?: CheckStatus }) {
    if (!status) return null;
    const meta = STATUS_META[status];
    const Icon = meta.Icon;
    return (
        <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={`inline-flex items-center gap-1.5 text-xs ${status === "ok" ? "text-green-600" : status === "degraded" ? "text-yellow-600" : "text-destructive"}`}>
                <Icon className="size-3" />
                {meta.label}
            </span>
        </div>
    );
}

// — Codec support indicator
function CodecRow({ label, supported, category }: { label: string; supported: boolean; category?: string }) {
    return (
        <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
                <span className="text-xs">{label}</span>
                {category && <span className="text-[10px] text-muted-foreground/60 tracking-wide uppercase">{category}</span>}
            </div>
            {supported ? (
                <span className="inline-flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 className="size-3" /> Supported
                </span>
            ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <XCircle className="size-3" /> Unsupported
                </span>
            )}
        </div>
    );
}

// — Browser detection
function getBrowserInfo() {
    if (typeof navigator === "undefined") return { name: "Unknown", version: "" };
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return { name: "Edge", version: ua.match(/Edg\/([\d.]+)/)?.[1] ?? "" };
    if (/OPR\//.test(ua)) return { name: "Opera", version: ua.match(/OPR\/([\d.]+)/)?.[1] ?? "" };
    if (/Chrome\//.test(ua) && !/Edg/.test(ua)) return { name: "Chrome", version: ua.match(/Chrome\/([\d.]+)/)?.[1] ?? "" };
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return { name: "Safari", version: ua.match(/Version\/([\d.]+)/)?.[1] ?? "" };
    if (/Firefox\//.test(ua)) return { name: "Firefox", version: ua.match(/Firefox\/([\d.]+)/)?.[1] ?? "" };
    return { name: "Unknown", version: "" };
}

function getPlatformInfo() {
    if (typeof navigator === "undefined") return { os: "Unknown", device: "Unknown" };
    const ua = navigator.userAgent;
    const ios = isIOS();
    const isMac = /Macintosh/.test(ua);
    const isWindows = /Windows/.test(ua);
    const isAndroid = /Android/.test(ua);
    const isLinux = /Linux/.test(ua) && !isAndroid;

    const os = ios ? "iOS" : isMac ? "macOS" : isWindows ? "Windows" : isAndroid ? "Android" : isLinux ? "Linux" : "Unknown";
    const device = ios || isAndroid ? "Mobile" : "Desktop";
    return { os, device };
}

// — Compatibility tab content
const CompatibilitySection = memo(function CompatibilitySection() {
    const [codecSupport] = useState<CodecSupport | null>(() =>
        typeof window !== "undefined" ? detectCodecSupport() : null
    );
    const [browser] = useState(() =>
        typeof window !== "undefined" ? getBrowserInfo() : { name: "—", version: "" }
    );
    const [platform] = useState(() =>
        typeof window !== "undefined" ? getPlatformInfo() : { os: "—", device: "—" }
    );

    const safari = typeof navigator !== "undefined" && isSafari();
    const ios = typeof navigator !== "undefined" && isIOS();

    // Compute overall playback rating
    const playbackRating = useMemo(() => {
        if (!codecSupport) return null;
        const videoScore = [codecSupport.h264, codecSupport.hevc, codecSupport.vp9, codecSupport.av1].filter(Boolean).length;
        const audioScore = [codecSupport.aac, codecSupport.ac3, codecSupport.eac3, codecSupport.dts, codecSupport.opus].filter(Boolean).length;
        const total = videoScore + audioScore;
        if (total >= 7) return { label: "Excellent", status: "ok" as CheckStatus, detail: "Most formats will play natively" };
        if (total >= 4) return { label: "Good", status: "ok" as CheckStatus, detail: "Common formats supported, some may need transcoding" };
        if (total >= 2) return { label: "Limited", status: "degraded" as CheckStatus, detail: "Many formats will need transcoding for playback" };
        return { label: "Poor", status: "error" as CheckStatus, detail: "Most formats will require transcoding or an external player" };
    }, [codecSupport]);

    return (
        <div className="space-y-4">
            {/* Device & Browser */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                        {platform.device === "Mobile" ? (
                            <Smartphone className="size-4 text-primary" />
                        ) : (
                            <Monitor className="size-4 text-primary" />
                        )}
                        Your Device
                    </CardTitle>
                    <CardDescription>Browser and platform information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <KeyValue label="Browser" value={browser.version ? `${browser.name} ${browser.version}` : browser.name} />
                    <KeyValue label="Platform" value={platform.os} />
                    <KeyValue label="Device" value={platform.device} />
                    {ios && <KeyValue label="iOS Mode" value="Yes — HLS preferred for best playback" />}
                    {safari && !ios && <KeyValue label="Safari Mode" value="Yes — HLS preferred for best playback" />}
                </CardContent>
            </Card>

            {/* Playback Rating */}
            {playbackRating && (
                <Card>
                    <CardHeader>
                        <CardTitle>Playback Compatibility</CardTitle>
                        <CardDescription>{playbackRating.detail}</CardDescription>
                        <CardAction>
                            <StatusBadge status={playbackRating.status} />
                        </CardAction>
                    </CardHeader>
                </Card>
            )}

            {/* Video Codecs */}
            <Card>
                <CardHeader>
                    <CardTitle>Video Codecs</CardTitle>
                    <CardDescription>Native browser video format support</CardDescription>
                </CardHeader>
                {codecSupport && (
                    <CardContent className="space-y-0.5">
                        <CodecRow label="H.264 / AVC" supported={codecSupport.h264} />
                        <CodecRow label="H.265 / HEVC" supported={codecSupport.hevc} />
                        <CodecRow label="VP9" supported={codecSupport.vp9} />
                        <CodecRow label="AV1" supported={codecSupport.av1} />
                    </CardContent>
                )}
            </Card>

            {/* Audio Codecs */}
            <Card>
                <CardHeader>
                    <CardTitle>Audio Codecs</CardTitle>
                    <CardDescription>Native browser audio format support</CardDescription>
                </CardHeader>
                {codecSupport && (
                    <CardContent className="space-y-0.5">
                        <CodecRow label="AAC" supported={codecSupport.aac} />
                        <CodecRow label="MP3" supported={codecSupport.mp3} />
                        <CodecRow label="Opus" supported={codecSupport.opus} />
                        <CodecRow label="FLAC" supported={codecSupport.flac} />
                        <div className="pt-2">
                            <SectionDivider label="Surround Sound" />
                        </div>
                        <CodecRow label="AC3 / Dolby Digital" supported={codecSupport.ac3} />
                        <CodecRow label="E-AC3 / Dolby Digital Plus" supported={codecSupport.eac3} />
                        <CodecRow label="DTS" supported={codecSupport.dts} />
                        <CodecRow label="Dolby TrueHD" supported={codecSupport.truehd} />
                    </CardContent>
                )}
            </Card>

            {/* Tips */}
            <Card>
                <CardHeader>
                    <CardTitle>Playback Tips</CardTitle>
                    <CardDescription>Getting the best experience</CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="space-y-2 text-xs text-muted-foreground">
                        {ios && (
                            <li className="flex gap-2">
                                <span className="text-primary shrink-0">•</span>
                                <span>iOS Safari has limited codec support. The player will auto-select HLS streams when available for best results.</span>
                            </li>
                        )}
                        {codecSupport && !codecSupport.ac3 && !codecSupport.eac3 && (
                            <li className="flex gap-2">
                                <span className="text-primary shrink-0">•</span>
                                <span>Your browser cannot play AC3/E-AC3 audio natively. MKV files with Dolby audio will be auto-transcoded for playback.</span>
                            </li>
                        )}
                        {codecSupport && !codecSupport.hevc && (
                            <li className="flex gap-2">
                                <span className="text-primary shrink-0">•</span>
                                <span>HEVC/H.265 is not supported. 4K HDR content encoded in HEVC may need an external player like VLC or Infuse.</span>
                            </li>
                        )}
                        <li className="flex gap-2">
                            <span className="text-primary shrink-0">•</span>
                            <span>For files that won&apos;t play, use the download option and open in VLC, Infuse, or another native player.</span>
                        </li>
                        {browser.name === "Chrome" && (
                            <li className="flex gap-2">
                                <span className="text-primary shrink-0">•</span>
                                <span>Chrome has the broadest codec support. Most files should play natively without transcoding.</span>
                            </li>
                        )}
                    </ul>
                </CardContent>
            </Card>

            {/* VLC Bridge — shown in Integrations tab */}
        </div>
    );
});

// ── VLC Bridge status card ─────────────────────────────────────────────────

const VLCBridgeCard = memo(function VLCBridgeCard() {
    const mediaPlayer = useSettingsStore((s) => s.settings.mediaPlayer);
    const extensionDetected = useVLCStore((s) => s.extensionDetected);
    const vlcConnected = useVLCStore((s) => s.vlcConnected);
    const status = useVLCStore((s) => s.status);
    const nowPlaying = useVLCStore((s) => s.nowPlaying);
    const detecting = useVLCStore((s) => s.detecting);
    const detect = useVLCStore((s) => s.detect);
    const startPolling = useVLCStore((s) => s.startPolling);
    const stopPolling = useVLCStore((s) => s.stopPolling);

    const isVLC = mediaPlayer === MediaPlayer.VLC;
    const isMobile = typeof navigator !== "undefined" && isMobileOrTablet();

    // Auto-detect and poll when card is visible (desktop only)
    useEffect(() => {
        if (!isVLC || isMobile) return;
        if (!extensionDetected && !detecting) {
            detect().then((found) => {
                if (found) startPolling();
            });
        } else if (extensionDetected) {
            startPolling();
        }
        return () => stopPolling();
    }, [isVLC, isMobile, extensionDetected, detecting, detect, startPolling, stopPolling]);

    // Overall status
    const overallStatus: CheckStatus = detecting
        ? "degraded"
        : extensionDetected && vlcConnected
          ? "ok"
          : extensionDetected
            ? "degraded"
            : "error";

    const stateLabel = status?.state === "playing"
        ? "Playing"
        : status?.state === "paused"
          ? "Paused"
          : status?.state === "stopped"
            ? "Stopped"
            : "—";

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <svg className="size-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    VLC Bridge
                </CardTitle>
                <CardDescription>
                    {isMobile ? "Desktop only — not available on mobile" : isVLC ? "Extension-based VLC integration" : "Set player to VLC to enable"}
                </CardDescription>
                <CardAction>
                    <StatusBadge status={overallStatus} />
                </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
                {isMobile ? (
                    <div className="text-xs text-muted-foreground">
                        VLC Bridge requires a Chrome/Edge desktop extension. On mobile, VLC is launched directly via intent and plays files without bridge integration.
                    </div>
                ) : (
                    <>
                        <ServiceRow
                            label="Extension"
                            status={detecting ? "degraded" : extensionDetected ? "ok" : "error"}
                        />
                        <ServiceRow
                            label="VLC Connection"
                            status={vlcConnected ? "ok" : extensionDetected ? "error" : undefined}
                        />
                        {vlcConnected && (
                            <>
                                <KeyValue label="State" value={stateLabel} />
                                {nowPlaying && <KeyValue label="Now Playing" value={nowPlaying} />}
                                {status && status.length > 0 && (
                                    <KeyValue
                                        label="Progress"
                                        value={`${formatTime(status.time)} / ${formatTime(status.length)}`}
                                    />
                                )}
                            </>
                        )}
                        {!extensionDetected && isVLC && !detecting && (
                            <div className="pt-2">
                                <Button variant="outline" size="sm" onClick={() => detect()}>
                                    <RefreshCw className="size-3 mr-1.5" />
                                    Retry Detection
                                </Button>
                            </div>
                        )}
                        {!isVLC && (
                            <div className="text-xs text-muted-foreground pt-1">
                                Change your media player to VLC in Settings to enable the bridge integration.
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
});

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

// ── Device Sync status card ────────────────────────────────────────────────

const DeviceSyncCard = memo(function DeviceSyncCard() {
    const connectionStatus = useDeviceSyncStore((s) => s.connectionStatus);
    const _enabled = useDeviceSyncStore((s) => s.enabled);
    const devices = useDeviceSyncStore((s) => s.devices);
    const thisDevice = useDeviceSyncStore((s) => s.thisDevice);
    const syncEnabled = useSettingsStore((s) => s.settings.deviceSync);
    const syncConfigured = !!(process.env.NEXT_PUBLIC_DEVICE_SYNC_URL);

    const overallStatus: CheckStatus = !syncConfigured
        ? "error"
        : !syncEnabled
          ? "degraded"
          : connectionStatus === "connected"
            ? "ok"
            : connectionStatus === "connecting"
              ? "degraded"
              : "error";

    const statusLabel = !syncConfigured
        ? "Not configured"
        : !syncEnabled
          ? "Disabled"
          : connectionStatus === "connected"
            ? "Connected"
            : connectionStatus === "connecting"
              ? "Connecting..."
              : "Disconnected";

    const otherDevices = devices.filter((d) => d.id !== thisDevice.id);

    const syncMeta = STATUS_META[overallStatus];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <Link2 className="size-4 text-primary" />
                    Device Sync
                </CardTitle>
                <CardDescription>
                    {!syncConfigured
                        ? "NEXT_PUBLIC_DEVICE_SYNC_URL not configured"
                        : "Cross-device playback via Cloudflare Durable Objects"}
                </CardDescription>
                <CardAction>
                    <Badge variant={syncMeta.variant}>
                        <syncMeta.Icon className="size-3.5" />
                        {statusLabel}
                    </Badge>
                </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
                <KeyValue label="Enabled" value={syncEnabled ? "Yes" : "No"} />
                {syncConfigured && syncEnabled && (
                    <>
                        <KeyValue label="WebSocket" value={connectionStatus === "connected" ? "Connected" : connectionStatus === "connecting" ? "Connecting…" : "Disconnected"} />
                        <KeyValue label="Devices online" value={otherDevices.length === 0 ? "None" : `${otherDevices.length} other ${otherDevices.length === 1 ? "device" : "devices"}`} />
                        {otherDevices.length > 0 && (
                            <KeyValue label="Devices" value={otherDevices.map((d) => d.name).join(", ")} />
                        )}
                    </>
                )}
                {!syncConfigured && (
                    <p className="text-xs text-muted-foreground pt-1">
                        Set <code className="font-mono text-xs">NEXT_PUBLIC_DEVICE_SYNC_URL</code> to enable cross-device playback control.
                    </p>
                )}
            </CardContent>
        </Card>
    );
});

// ── Trakt status card ──────────────────────────────────────────────────────

const TraktCard = memo(function TraktCard() {
    const { data: serverSettings } = useUserSettings();
    const isConnected = !!serverSettings?.trakt_access_token;
    const expiresAt = serverSettings?.trakt_expires_at;
    const [now] = useState(() => Date.now());

    const { expiryLabel, overallStatus } = useMemo<{ expiryLabel: string; overallStatus: CheckStatus }>(() => {
        if (!isConnected) return { expiryLabel: "—", overallStatus: "error" };
        if (!expiresAt) return { expiryLabel: "—", overallStatus: "ok" };
        const expiryMs = expiresAt * 1000;
        const diffDays = Math.round((expiryMs - now) / 86400000);
        const expired = expiryMs < now;
        const label = expired
            ? "Expired"
            : diffDays === 0
              ? "Expires today"
              : diffDays === 1
                ? "Expires tomorrow"
                : `Expires in ${diffDays} days`;
        return { expiryLabel: label, overallStatus: expired ? "degraded" : "ok" };
    }, [isConnected, expiresAt, now]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <svg className="size-4 text-primary" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10.296 2.023C5.689 2.023 2 5.775 2 10.313s3.688 8.29 8.296 8.29c2.168 0 4.247-.839 5.835-2.335l-1.74-1.674a5.73 5.73 0 01-4.095 1.687c-3.119 0-5.653-2.59-5.653-5.77s2.534-5.771 5.653-5.771a5.65 5.65 0 014.067 1.735l1.748-1.642A8.187 8.187 0 0010.296 2.023zM22 5.38l-3.394 3.394-1.453-1.453L22 2.023v3.357zm-5.247.99l-1.453 1.49 3.8 3.772-3.8 3.772 1.453 1.453 5.247-5.225L16.753 6.37z"/>
                    </svg>
                    Trakt
                </CardTitle>
                <CardDescription>Scrobbling, watchlist, and history sync</CardDescription>
                <CardAction>
                    <StatusBadge status={overallStatus} />
                </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
                <KeyValue label="Connected" value={isConnected ? "Yes" : "No"} />
                {isConnected && <KeyValue label="Token" value={expiryLabel} />}
                {!isConnected && (
                    <p className="text-xs text-muted-foreground pt-1">
                        Connect Trakt in Settings → Integrations to enable scrobbling and watchlist sync.
                    </p>
                )}
            </CardContent>
        </Card>
    );
});

export default function StatusPage() {
    const [data, setData] = useState<HealthResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [refreshInterval, setRefreshInterval] = useState("60000");
    const [rawExpanded, setRawExpanded] = useState(false);

    const fetchHealth = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchWithTimeout(`/api/health?ts=${Date.now()}`, { cache: "no-store" }, 10000);
            const json = (await response.json()) as HealthResponse;
            setData(json);
            if (!response.ok) {
                const dbError = json.checks?.db?.error;
                setError(dbError || "Health check failed");
            }
            setLastUpdated(new Date().toLocaleString());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch health status");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchHealth();
    }, [fetchHealth]);

    useEffect(() => {
        const intervalMs = Number(refreshInterval);
        if (!intervalMs) return;
        const id = setInterval(fetchHealth, intervalMs);
        return () => clearInterval(id);
    }, [fetchHealth, refreshInterval]);

    const overallStatus = data?.status ?? "error";
    const overallMeta = STATUS_META[overallStatus];
    const OverallIcon = overallMeta.Icon;

    const rawJson = useMemo(() => (data ? JSON.stringify(data, null, 2) : ""), [data]);

    return (
        <div className="mx-auto w-full max-w-5xl space-y-10 pb-16">
            <PageHeader
                icon={Activity}
                title="System Status"
                description="Live status of services, integrations, and device compatibility"
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground hidden sm:inline">Auto refresh</span>
                            <Select value={refreshInterval} onValueChange={setRefreshInterval}>
                                <SelectTrigger className="min-w-[110px]" size="sm">
                                    <SelectValue placeholder="Auto refresh" />
                                </SelectTrigger>
                                <SelectContent align="end">
                                    {REFRESH_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={fetchHealth} disabled={isLoading} variant="outline">
                            <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>
                }
            />

            {/* Overview */}
            <section className="space-y-4">
                <SectionDivider label="Overview" />
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3">
                            <OverallIcon className="size-5 text-primary" />
                            {overallMeta.label}
                        </CardTitle>
                        <CardDescription>
                            {lastUpdated ? `Last checked ${lastUpdated}` : "Checking status..."}
                        </CardDescription>
                        <CardAction>
                            <StatusBadge status={overallStatus} />
                        </CardAction>
                    </CardHeader>
                    <CardContent className="space-y-0.5">
                        {error ? (
                            <ErrorState title="Status check failed" description={error} className="py-6" />
                        ) : isLoading && !data ? (
                            <LoadingState label="Checking system status" className="py-6" />
                        ) : (
                            <>
                                <ServiceRow label="Database" status={data?.checks.db.status} />
                                <ServiceRow label="Authentication" status={data?.checks.auth.status} />
                                <ServiceRow label="Deployment" status={data?.checks.build.status} />
                            </>
                        )}
                    </CardContent>
                </Card>
            </section>

            {/* Tabs: Services + Compatibility */}
            <Tabs defaultValue="services">
                <TabsList variant="line" className="w-full justify-start">
                    <TabsTrigger value="services">Services</TabsTrigger>
                    <TabsTrigger value="compatibility">Compatibility</TabsTrigger>
                    <TabsTrigger value="integrations">Integrations</TabsTrigger>
                </TabsList>

                <TabsContent value="services" className="space-y-4 pt-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Database</CardTitle>
                                <CardDescription>Connectivity &amp; performance</CardDescription>
                                <CardAction>
                                    {data ? <StatusBadge status={data.checks.db.status} /> : null}
                                </CardAction>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <KeyValue
                                    label="Connection Mode"
                                    value={data?.checks.connection?.viaHyperdrive ? "Hyperdrive (pooled)" : data?.checks.connection?.source === "env" || data?.checks.connection?.source === "ctx-env" ? "Direct" : "—"}
                                />
                                <KeyValue label="Latency" value={data?.checks.db.latencyMs ? `${data.checks.db.latencyMs}ms` : "—"} />
                                {data?.checks.db.error && <KeyValue label="Error" value={data.checks.db.error} />}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Authentication</CardTitle>
                                <CardDescription>Sign-in &amp; session management</CardDescription>
                                <CardAction>
                                    {data ? <StatusBadge status={data.checks.auth.status} /> : null}
                                </CardAction>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <KeyValue label="Google Sign-In" value={formatValue(data?.checks.auth.googleOAuthEnabled)} />
                                {data?.checks.auth.errors && data.checks.auth.errors.length > 0 && (
                                    <KeyValue label="Issues" value={formatList(data.checks.auth.errors)} />
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Deployment</CardTitle>
                                <CardDescription>Current build status</CardDescription>
                                <CardAction>
                                    {data ? <StatusBadge status={data.checks.build.status} /> : null}
                                </CardAction>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <KeyValue label="Environment" value={data?.checks.build.nodeEnv === "production" ? "Production" : formatValue(data?.checks.build.nodeEnv)} />
                                {data?.checks.build.buildTime && (
                                    <KeyValue label="Last Built" value={formatValue(data.checks.build.buildTime)} />
                                )}
                            </CardContent>
                        </Card>

                        {/* Show environment warnings only if there are issues */}
                        {data?.checks.env.status !== "ok" && (
                            <Card>
                                <CardHeader>
                                    <CardTitle>Configuration</CardTitle>
                                    <CardDescription>Issues detected</CardDescription>
                                    <CardAction>
                                        {data ? <StatusBadge status={data.checks.env.status} /> : null}
                                    </CardAction>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {data?.checks.env.missing && data.checks.env.missing.length > 0 && (
                                        <KeyValue label="Missing Config" value={formatList(data.checks.env.missing)} />
                                    )}
                                    {data?.checks.env.warnings && data.checks.env.warnings.length > 0 && (
                                        <KeyValue label="Warnings" value={formatList(data.checks.env.warnings)} />
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Collapsible raw JSON — developer diagnostics */}
                    <div>
                        <button
                            onClick={() => setRawExpanded(!rawExpanded)}
                            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
                        >
                            <ChevronDown className={`size-3.5 transition-transform duration-300 ${rawExpanded ? "rotate-0" : "-rotate-90"}`} />
                            <span className="tracking-widest uppercase">Diagnostics</span>
                        </button>
                        {rawExpanded && (
                            <Card>
                                <CardContent className="pt-4">
                                    {rawJson ? (
                                        <pre className="max-h-80 overflow-auto rounded-sm border border-border/50 bg-muted/30 p-4 text-xs">
                                            {rawJson}
                                        </pre>
                                    ) : (
                                        <LoadingState label="Loading diagnostics" className="py-6" />
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="compatibility" className="space-y-4 pt-4">
                    <CompatibilitySection />
                </TabsContent>

                <TabsContent value="integrations" className="space-y-4 pt-4">
                    <TraktCard />
                    <DeviceSyncCard />
                    <VLCBridgeCard />
                </TabsContent>
            </Tabs>
        </div>
    );
}
