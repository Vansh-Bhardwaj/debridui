"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, Play, Trash2, Clock, Info, Settings, Zap, Sliders, Languages, FastForward, Type, SkipForward, Captions, ExternalLink, RefreshCw } from "lucide-react";
import {
    useSettingsStore,
    type StreamingSettings,
    type StreamingResolution,
    type QualityProfileId,
    type QualityRange,
    type PlaybackSettings,
    QUALITY_PROFILES,
} from "@/lib/stores/settings";
import { RESOLUTIONS, SOURCE_QUALITIES } from "@/lib/addons/parser";
import { Resolution, SourceQuality } from "@/lib/addons/types";
import { MediaPlayer } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { del } from "idb-keyval";
import { queryClient } from "@/lib/query-client";
import { toast } from "sonner";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { formatDistanceToNow, format } from "date-fns";
import { PageHeader } from "@/components/common/page-header";
import { SectionDivider } from "@/components/common/section-divider";
import { detectPlatform, isSupportedPlayer, PLAYER_PLATFORM_SUPPORT } from "@/lib/utils/media-player";
import { getPlayerSetupInstruction } from "./player-setup-instructions";
import { cn } from "@/lib/utils";
import { useUserSettings, useSaveUserSettings, useDisconnectTrakt, hydrateSettingsFromServer } from "@/hooks/use-user-settings";
import { useEffect, useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

function TraktLogo({ className }: { className?: string }) {
    return (
        <img
            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/trakt.svg"
            alt=""
            className={cn("dark:invert", className)}
        />
    );
}

function TmdbLogo({ className }: { className?: string }) {
    return (
        <img
            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/themoviedatabase.svg"
            alt=""
            className={cn("dark:invert", className)}
        />
    );
}

// Build timestamp - injected at build time via next.config.ts, fallback to current time in dev
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString();

const RESOLUTION_OPTIONS: { value: StreamingResolution; label: string }[] = [
    { value: "any", label: "Any" },
    ...RESOLUTIONS.map((r) => ({ value: r, label: r === Resolution.UHD_4K ? "4K" : r })).reverse(),
];

const SOURCE_QUALITY_OPTIONS: { value: SourceQuality | "any"; label: string }[] = [
    { value: "any", label: "Any" },
    ...SOURCE_QUALITIES.map((q) => ({ value: q, label: q })),
];

export default function SettingsPage() {
    const TMDB_SAVE_DEBOUNCE_MS = 600;
    const { theme, setTheme } = useTheme();
    const { currentAccount } = useAuthGuaranteed();
    const buildDate = new Date(BUILD_TIME);
    const buildTimeFormatted = format(buildDate, "PPpp");
    const buildTimeRelative = formatDistanceToNow(buildDate, { addSuffix: true });
    const { get, set, getPresets } = useSettingsStore();
    const mediaPlayer = get("mediaPlayer");
    const mediaPlayerPresets = getPresets("mediaPlayer") || [];
    const streaming = get("streaming");
    const playback = get("playback");
    const tmdbApiKey = get("tmdbApiKey");
    const deviceSync = get("deviceSync");

    // Server-side settings sync
    const { data: serverSettings } = useUserSettings();
    const { mutate: saveSettings } = useSaveUserSettings();
    const { mutate: disconnectTrakt, isPending: isDisconnecting } = useDisconnectTrakt();
    const tmdbSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [tmdbSaveState, setTmdbSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

    const isTraktConnected = !!serverSettings?.trakt_access_token;

    // Show toast when returning from Trakt OAuth flow
    const searchParams = useSearchParams();
    useEffect(() => {
        const traktParam = searchParams.get("trakt");
        if (traktParam === "connected") {
            toast.success("Trakt connected successfully");
            // Force refetch — cached data won't have the new token
            queryClient.invalidateQueries({ queryKey: ["user-settings"] });
        } else if (traktParam === "error") {
            const reason = searchParams.get("reason");
            const messages: Record<string, string> = {
                no_code: "No authorization code received from Trakt",
                config: "Trakt client ID or secret not configured on server",
                exchange: "Failed to exchange authorization code with Trakt",
                state_mismatch: "Security validation failed — please try connecting again",
            };
            toast.error(messages[reason ?? ""] || "Failed to connect Trakt");
        }
    }, [searchParams]);

    const handleTraktConnect = useCallback(() => {
        const clientId = process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID;
        if (!clientId) { toast.error("Trakt client ID not configured"); return; }
        const redirectUri = `${window.location.origin}/api/trakt/callback`;
        // Generate OAuth state for CSRF protection
        const state = crypto.randomUUID();
        document.cookie = `trakt_oauth_state=${state}; path=/; max-age=600; samesite=lax; secure`;
        const url = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
        window.location.href = url;
    }, []);

    useEffect(() => {
        hydrateSettingsFromServer(serverSettings ?? null);
    }, [serverSettings]);

    useEffect(() => {
        return () => {
            if (tmdbSaveTimeout.current) {
                clearTimeout(tmdbSaveTimeout.current);
            }
        };
    }, []);

    const handleTmdbKeyChange = (value: string) => {
        set("tmdbApiKey", value);
        setTmdbSaveState("saving");

        if (tmdbSaveTimeout.current) {
            clearTimeout(tmdbSaveTimeout.current);
        }

        tmdbSaveTimeout.current = setTimeout(() => {
            saveSettings(
                { tmdb_api_key: value || undefined },
                {
                    onSuccess: () => {
                        setTmdbSaveState("saved");
                        setTimeout(() => setTmdbSaveState("idle"), 1500);
                    },
                    onError: () => {
                        setTmdbSaveState("error");
                    },
                }
            );
        }, TMDB_SAVE_DEBOUNCE_MS);
    };

    const updateStreaming = (updates: Partial<StreamingSettings>) => {
        set("streaming", { ...streaming, ...updates });
    };

    const updateCustomRange = (updates: Partial<QualityRange>) => {
        updateStreaming({
            customRange: { ...streaming.customRange, ...updates },
        });
    };

    const updatePlayback = (updates: Partial<PlaybackSettings>) => {
        set("playback", { ...playback, ...updates });
    };

    const selectProfile = (profileId: QualityProfileId) => {
        if (profileId === "custom" && streaming.profileId !== "custom") {
            // Copy current profile's range to custom when switching to custom
            const currentProfile = QUALITY_PROFILES.find((p) => p.id === streaming.profileId);
            if (currentProfile) {
                updateStreaming({ profileId, customRange: { ...currentProfile.range } });
                return;
            }
        }
        updateStreaming({ profileId });
    };

    const platform = detectPlatform();
    const setupInstruction = getPlayerSetupInstruction(mediaPlayer, platform);
    const isPlayerSupported = isSupportedPlayer(mediaPlayer, platform);

    const handleClearCache = async (key?: string[]) => {
        const toastId = toast.loading("Clearing cache...");
        try {
            if (key) {
                queryClient.removeQueries({ queryKey: key });
            } else {
                await del("DEBRIDUI_CACHE");
                queryClient.clear();
            }
            toast.success("Cache cleared successfully", { id: toastId });
        } catch (error) {
            toast.error("Failed to clear cache", { id: toastId });
            console.error("Error clearing cache:", error);
        }
    };

    const themes = [
        { value: "light", label: "Light", icon: Sun },
        { value: "dark", label: "Dark", icon: Moon },
        { value: "system", label: "System", icon: Monitor },
    ];

    const isCustom = streaming.profileId === "custom";

    return (
        <div className="mx-auto w-full max-w-4xl space-y-8 pb-16">
            <PageHeader icon={Settings} title="Settings" description="Manage your application preferences" />

            {/* ─── Integrations (highest priority) ─── */}
            <section className="space-y-4">
                <SectionDivider label="Integrations" />

                {/* Trakt — prominent card */}
                <div className="rounded-sm border border-border/50 overflow-hidden transition-colors duration-200">
                    <div className="flex items-center justify-between gap-4 p-4">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-[#ED1C24]/10">
                                <TraktLogo className="size-5" />
                            </div>
                            <div className="space-y-0.5 min-w-0">
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm font-medium">Trakt</Label>
                                    {isTraktConnected && (
                                        <span className="inline-flex items-center rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                            Connected
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {isTraktConnected
                                        ? "Scrobbling, watchlist & calendar synced to your profile"
                                        : "Scrobble playback, sync watchlist & calendar"}
                                </p>
                            </div>
                        </div>
                        {isTraktConnected ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => disconnectTrakt()}
                                disabled={isDisconnecting}
                            >
                                Disconnect
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                onClick={handleTraktConnect}
                            >
                                <ExternalLink className="size-3.5" />
                                Connect
                            </Button>
                        )}
                    </div>
                </div>

                {/* TMDB */}
                <div className="rounded-sm border border-border/50 overflow-hidden transition-colors duration-200">
                    <div className="p-4 space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-[#01b4e4]/10">
                                <TmdbLogo className="size-5" />
                            </div>
                            <div className="space-y-0.5 min-w-0">
                                <Label htmlFor="tmdb-api-key" className="text-sm font-medium">TMDB</Label>
                                <p className="text-xs text-muted-foreground">
                                    Episode grouping for TV shows.{" "}
                                    <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">
                                        Get a free key
                                    </a>
                                </p>
                                {tmdbSaveState !== "idle" && (
                                    <p
                                        className={cn(
                                            "text-[11px] tracking-wide uppercase",
                                            tmdbSaveState === "error"
                                                ? "text-destructive"
                                                : "text-muted-foreground"
                                        )}
                                    >
                                        {tmdbSaveState === "saving" && "Saving..."}
                                        {tmdbSaveState === "saved" && "Saved"}
                                        {tmdbSaveState === "error" && "Save failed"}
                                    </p>
                                )}
                            </div>
                        </div>
                        <Input
                            id="tmdb-api-key"
                            type="password"
                            placeholder="Enter your TMDB API key"
                            value={tmdbApiKey}
                            onChange={(e) => handleTmdbKeyChange(e.target.value)}
                            className="max-w-md"
                        />
                    </div>
                </div>

                {/* Device Sync */}
                <div className="flex items-center justify-between gap-4 rounded-sm border border-border/50 p-4 transition-colors duration-200">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary/10">
                            <RefreshCw className="size-5 text-primary" />
                        </div>
                        <div className="space-y-0.5 min-w-0">
                            <Label htmlFor="device-sync" className="text-sm font-medium">Device Sync</Label>
                            <p className="text-xs text-muted-foreground">
                                Sync playback state & controls across your devices in real-time
                            </p>
                        </div>
                    </div>
                    <Switch
                        id="device-sync"
                        className="shrink-0"
                        checked={deviceSync}
                        onCheckedChange={(checked) => set("deviceSync", checked)}
                    />
                </div>
            </section>

            {/* ─── Playback (most frequently changed) ─── */}
            <section className="space-y-4">
                <SectionDivider label="Playback" />

                <div className="space-y-4">
                    {/* Auto-Resume */}
                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <Play className="size-4 text-muted-foreground shrink-0" />
                                <Label htmlFor="auto-resume" className="text-sm">
                                    Auto-Resume
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Resume playback from where you left off
                            </p>
                        </div>
                        <Switch
                            id="auto-resume"
                            className="shrink-0"
                            checked={playback.autoResume}
                            onCheckedChange={(checked) => updatePlayback({ autoResume: checked })}
                        />
                    </div>

                    {/* Auto-Next Episode */}
                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <SkipForward className="size-4 text-muted-foreground shrink-0" />
                                <Label htmlFor="auto-next-episode" className="text-sm">
                                    Auto-Play Next Episode
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Automatically play the next episode when current one ends
                            </p>
                        </div>
                        <Switch
                            id="auto-next-episode"
                            className="shrink-0"
                            checked={playback.autoNextEpisode}
                            onCheckedChange={(checked) => updatePlayback({ autoNextEpisode: checked })}
                        />
                    </div>

                    {/* Playback Speed */}
                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <FastForward className="size-4 text-muted-foreground shrink-0" />
                                <Label className="text-sm">Playback Speed</Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Default video playback speed
                            </p>
                        </div>
                        <Select
                            value={String(playback.playbackSpeed)}
                            onValueChange={(v) => updatePlayback({ playbackSpeed: parseFloat(v) })}>
                            <SelectTrigger className="w-24">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0.5">0.5x</SelectItem>
                                <SelectItem value="0.75">0.75x</SelectItem>
                                <SelectItem value="1">1.0x</SelectItem>
                                <SelectItem value="1.25">1.25x</SelectItem>
                                <SelectItem value="1.5">1.5x</SelectItem>
                                <SelectItem value="1.75">1.75x</SelectItem>
                                <SelectItem value="2">2.0x</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Subtitle Language */}
                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <Captions className="size-4 text-muted-foreground shrink-0" />
                                <Label className="text-sm">Subtitle Language</Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Auto-select subtitles in this language
                            </p>
                        </div>
                        <Select
                            value={playback.subtitleLanguage}
                            onValueChange={(v) => updatePlayback({ subtitleLanguage: v })}>
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="english">English</SelectItem>
                                <SelectItem value="spanish">Spanish</SelectItem>
                                <SelectItem value="french">French</SelectItem>
                                <SelectItem value="german">German</SelectItem>
                                <SelectItem value="italian">Italian</SelectItem>
                                <SelectItem value="portuguese">Portuguese</SelectItem>
                                <SelectItem value="russian">Russian</SelectItem>
                                <SelectItem value="japanese">Japanese</SelectItem>
                                <SelectItem value="korean">Korean</SelectItem>
                                <SelectItem value="hindi">Hindi</SelectItem>
                                <SelectItem value="arabic">Arabic</SelectItem>
                                <SelectItem value="chinese">Chinese</SelectItem>
                                <SelectItem value="dutch">Dutch</SelectItem>
                                <SelectItem value="polish">Polish</SelectItem>
                                <SelectItem value="turkish">Turkish</SelectItem>
                                <SelectItem value="swedish">Swedish</SelectItem>
                                <SelectItem value="czech">Czech</SelectItem>
                                <SelectItem value="romanian">Romanian</SelectItem>
                                <SelectItem value="greek">Greek</SelectItem>
                                <SelectItem value="thai">Thai</SelectItem>
                                <SelectItem value="vietnamese">Vietnamese</SelectItem>
                                <SelectItem value="indonesian">Indonesian</SelectItem>
                                <SelectItem value="ukrainian">Ukrainian</SelectItem>
                                <SelectItem value="norwegian">Norwegian</SelectItem>
                                <SelectItem value="danish">Danish</SelectItem>
                                <SelectItem value="finnish">Finnish</SelectItem>
                                <SelectItem value="hebrew">Hebrew</SelectItem>
                                <SelectItem value="hungarian">Hungarian</SelectItem>
                                <SelectItem value="bulgarian">Bulgarian</SelectItem>
                                <SelectItem value="croatian">Croatian</SelectItem>
                                <SelectItem value="serbian">Serbian</SelectItem>
                                <SelectItem value="malay">Malay</SelectItem>
                                <SelectItem value="slovak">Slovak</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Subtitle Size */}
                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <Type className="size-4 text-muted-foreground shrink-0" />
                                <Label className="text-sm">Subtitle Size</Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Text size for subtitles
                            </p>
                        </div>
                        <Select
                            value={String(playback.subtitleSize)}
                            onValueChange={(v) => updatePlayback({ subtitleSize: parseInt(v) })}>
                            <SelectTrigger className="w-24">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="16">Small</SelectItem>
                                <SelectItem value="20">Medium</SelectItem>
                                <SelectItem value="24">Default</SelectItem>
                                <SelectItem value="32">Large</SelectItem>
                                <SelectItem value="40">X-Large</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </section>

            {/* ─── Streaming ─── */}
            <section className="space-y-4">
                <SectionDivider label="Streaming" />

                {/* Quality Profile */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Sliders className="size-4 text-muted-foreground" />
                        <Label className="text-sm">Quality Profile</Label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {QUALITY_PROFILES.map((profile) => (
                            <button
                                key={profile.id}
                                onClick={() => selectProfile(profile.id)}
                                className={cn(
                                    "group relative px-3 py-1.5 text-sm rounded-sm border transition-all duration-300",
                                    streaming.profileId === profile.id
                                        ? "border-primary bg-primary/5 text-foreground"
                                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                                )}>
                                <span className="font-medium">{profile.name}</span>
                                <span className="ml-1.5 text-xs opacity-60">{profile.description}</span>
                            </button>
                        ))}
                        <button
                            onClick={() => selectProfile("custom")}
                            className={cn(
                                "group relative px-3 py-1.5 text-sm rounded-sm border transition-all duration-300",
                                isCustom
                                    ? "border-primary bg-primary/5 text-foreground"
                                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                            )}>
                            <span className="font-medium">Custom</span>
                        </button>
                    </div>

                    <Collapsible open={isCustom}>
                        <CollapsibleContent>
                            <div className="mt-3 p-4 rounded-sm border border-border/50 bg-muted/10 space-y-5">
                                <div className="space-y-3">
                                    <span className="text-xs tracking-widest uppercase text-muted-foreground">
                                        Resolution
                                    </span>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <span className="text-xs text-muted-foreground">Minimum</span>
                                            <Select
                                                value={streaming.customRange.minResolution}
                                                onValueChange={(v) =>
                                                    updateCustomRange({ minResolution: v as StreamingResolution })
                                                }>
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {RESOLUTION_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-xs text-muted-foreground">Maximum</span>
                                            <Select
                                                value={streaming.customRange.maxResolution}
                                                onValueChange={(v) =>
                                                    updateCustomRange({ maxResolution: v as StreamingResolution })
                                                }>
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {RESOLUTION_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <span className="text-xs tracking-widest uppercase text-muted-foreground">
                                        Source Quality
                                    </span>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <span className="text-xs text-muted-foreground">Minimum</span>
                                            <Select
                                                value={streaming.customRange.minSourceQuality}
                                                onValueChange={(v) =>
                                                    updateCustomRange({
                                                        minSourceQuality: v as SourceQuality | "any",
                                                    })
                                                }>
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {SOURCE_QUALITY_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-xs text-muted-foreground">Maximum</span>
                                            <Select
                                                value={streaming.customRange.maxSourceQuality}
                                                onValueChange={(v) =>
                                                    updateCustomRange({
                                                        maxSourceQuality: v as SourceQuality | "any",
                                                    })
                                                }>
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {SOURCE_QUALITY_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    Sources outside these ranges will be filtered out during auto-selection.
                                </p>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                </div>

                {/* Streaming toggles */}
                <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <Play className="size-4 text-muted-foreground shrink-0" />
                                <Label htmlFor="auto-play" className="text-sm">
                                    Auto-play
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Automatically start playback when a cached source is found
                            </p>
                        </div>
                        <Switch
                            id="auto-play"
                            className="shrink-0"
                            checked={streaming.autoPlay}
                            onCheckedChange={(checked) => updateStreaming({ autoPlay: checked })}
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <Zap className="size-4 text-muted-foreground shrink-0" />
                                <Label htmlFor="prefer-cached" className="text-sm">
                                    Prefer Cached Sources
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Prioritize cached sources even if lower quality is available
                            </p>
                        </div>
                        <Switch
                            id="prefer-cached"
                            className="shrink-0"
                            checked={streaming.preferCached}
                            onCheckedChange={(checked) => updateStreaming({ preferCached: checked })}
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <Zap className="size-4 text-muted-foreground shrink-0" />
                                <Label htmlFor="allow-uncached" className="text-sm">
                                    Allow Uncached Sources
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Automatically play uncached sources without confirmation
                            </p>
                        </div>
                        <Switch
                            id="allow-uncached"
                            className="shrink-0"
                            checked={streaming.allowUncached}
                            onCheckedChange={(checked) => updateStreaming({ allowUncached: checked })}
                        />
                    </div>

                    {/* Preferred Language */}
                    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                                <Languages className="size-4 text-muted-foreground shrink-0" />
                                <Label htmlFor="preferred-language" className="text-sm">
                                    Preferred Language
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Prioritize sources matching this audio language
                            </p>
                        </div>
                        <Select
                            value={streaming.preferredLanguage}
                            onValueChange={(value) => updateStreaming({ preferredLanguage: value })}>
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="english">English</SelectItem>
                                <SelectItem value="spanish">Spanish</SelectItem>
                                <SelectItem value="french">French</SelectItem>
                                <SelectItem value="german">German</SelectItem>
                                <SelectItem value="italian">Italian</SelectItem>
                                <SelectItem value="portuguese">Portuguese</SelectItem>
                                <SelectItem value="russian">Russian</SelectItem>
                                <SelectItem value="japanese">Japanese</SelectItem>
                                <SelectItem value="korean">Korean</SelectItem>
                                <SelectItem value="hindi">Hindi</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </section>

            {/* ─── Appearance ─── */}
            <section className="space-y-4">
                <SectionDivider label="Appearance" />

                <div className="grid gap-6 md:grid-cols-2">
                    {/* Theme */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Monitor className="size-4 text-muted-foreground" />
                            <Label htmlFor="theme" className="text-sm">
                                Theme
                            </Label>
                        </div>
                        <Select value={theme} onValueChange={setTheme}>
                            <SelectTrigger id="theme" className="w-full">
                                <SelectValue placeholder="Select theme" />
                            </SelectTrigger>
                            <SelectContent>
                                {themes.map((themeOption) => {
                                    const Icon = themeOption.icon;
                                    return (
                                        <SelectItem key={themeOption.value} value={themeOption.value}>
                                            <div className="flex items-center gap-2">
                                                <Icon className="size-3.5" />
                                                <span>{themeOption.label}</span>
                                            </div>
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Select your preferred color scheme for the interface
                        </p>
                    </div>

                    {/* Media Player (external) */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Play className="size-4 text-muted-foreground" />
                            <Label htmlFor="media-player" className="text-sm">
                                Default Player
                            </Label>
                        </div>
                        <Select value={mediaPlayer} onValueChange={(value) => set("mediaPlayer", value as MediaPlayer)}>
                            <SelectTrigger id="media-player" className="w-full">
                                <SelectValue placeholder="Select media player">
                                    {mediaPlayerPresets.find((p) => p.value === mediaPlayer)?.label}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {mediaPlayerPresets.map((preset) => (
                                    <SelectItem key={preset.value} value={preset.value}>
                                        <div className="flex flex-col gap-0.5">
                                            <span>{preset.label}</span>
                                            <span className="text-xs text-muted-foreground">{preset.description}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            External players require the application to be installed
                        </p>
                    </div>
                </div>

                {!isPlayerSupported && (
                    <div className="flex items-start gap-3 rounded-sm border border-yellow-500/50 bg-yellow-500/10 p-3 text-xs text-yellow-600 dark:text-yellow-500">
                        <Info className="size-3.5 shrink-0 mt-0.5" />
                        <p>
                            {mediaPlayer} is not officially supported on {platform}. Supported platforms:{" "}
                            {PLAYER_PLATFORM_SUPPORT[mediaPlayer].join(", ")}
                        </p>
                    </div>
                )}

                {setupInstruction && (
                    <div className="flex items-start gap-3 rounded-sm border border-border/50 p-3 text-xs text-muted-foreground">
                        <Info className="size-3.5 shrink-0 mt-0.5" />
                        <p>{setupInstruction}</p>
                    </div>
                )}
            </section>

            {/* ─── Cache & Data ─── */}
            <section className="space-y-4">
                <SectionDivider label="Cache & Data" />

                {/* Cache Management */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Trash2 className="size-4 text-muted-foreground" />
                        <span className="text-sm">Clear Cache</span>
                    </div>

                    <div className="space-y-2">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-sm border border-border/50 p-3">
                            <div>
                                <p className="text-sm">Download Links Cache</p>
                                <p className="text-xs text-muted-foreground">Remove all cached download links</p>
                            </div>
                            <Button
                                onClick={() => handleClearCache([currentAccount.id, "getDownloadLink"])}
                                variant="outline">
                                Clear Links
                            </Button>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-sm border border-destructive/30 bg-destructive/5 p-3">
                            <div>
                                <p className="text-sm">All Cached Data</p>
                                <p className="text-xs text-muted-foreground">Remove all cached data from browser</p>
                            </div>
                            <Button onClick={() => handleClearCache()} variant="destructive">
                                Clear All
                            </Button>
                        </div>
                    </div>
                </div>
            </section>

            {/* ─── About ─── */}
            <section className="space-y-4">
                <SectionDivider label="About" />

                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <Clock className="size-3.5 shrink-0" />
                        <span>Last updated {buildTimeRelative}</span>
                    </div>
                    <span className="text-border hidden sm:inline">·</span>
                    <span className="text-xs pl-5.5 sm:pl-0">{buildTimeFormatted}</span>
                </div>
            </section>
        </div>
    );
}
