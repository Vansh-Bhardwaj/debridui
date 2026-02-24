"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, Settings, Plus, Minus, ExternalLink, AlertCircle, SkipBack, SkipForward, RefreshCw, Cast, PictureInPicture2, X, ChevronRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { getProxyUrl, isNonMP4Video, openInPlayer, isSupportedPlayer } from "@/lib/utils";
import { selectBestStreamingUrl } from "@/lib/utils/codec-support";
import type { AddonSubtitle } from "@/lib/addons/types";
import { getLanguageDisplayName, isSubtitleLanguage } from "@/lib/utils/subtitles";
import { useSettingsStore } from "@/lib/stores/settings";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LegacyPlayerSubtitleStyle } from "@/components/preview/legacy-player-subtitle-style";
import { VideoCodecWarning } from "@/components/preview/video-codec-warning";
import { useProgress, type ProgressKey } from "@/hooks/use-progress";
import { useTraktScrobble } from "@/hooks/use-trakt-scrobble";
import { useIntroSegments } from "@/hooks/use-intro-segments";
import { DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { traktClient } from "@/lib/trakt";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import { cn } from "@/lib/utils";

/** Parsed subtitle cue for manual rendering */
interface SubtitleCue {
    start: number;
    end: number;
    text: string;
}

/** iOS Safari requires user gesture to start playback and often requires Range request support from the server. */
function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    // Standard iOS detection
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
    // iPadOS 13+ sends macOS UA but has touch support
    if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
    return false;
}

function normalizeLangCode(code?: string | null): string | null {
    if (!code) return null;
    const lower = code.trim().toLowerCase();
    if (!lower) return null;

    const iso639_2_to_1: Record<string, string> = {
        eng: "en",
        spa: "es",
        fra: "fr",
        fre: "fr",
        deu: "de",
        ger: "de",
        ita: "it",
        por: "pt",
        rus: "ru",
        hin: "hi",
        jpn: "ja",
        kor: "ko",
        zho: "zh",
        chi: "zh",
        ara: "ar",
        tur: "tr",
        ukr: "uk",
        pol: "pl",
        nld: "nl",
        dut: "nl",
        swe: "sv",
        nor: "no",
        dan: "da",
        fin: "fi",
        ces: "cs",
        cze: "cs",
        ron: "ro",
        rum: "ro",
        ell: "el",
        gre: "el",
        heb: "he",
        tha: "th",
        vie: "vi",
        ind: "id",
    };

    if (lower.length === 3) {
        return iso639_2_to_1[lower] ?? lower;
    }

    return lower;
}

interface AudioTrackInfo {
    enabled: boolean;
    label?: string;
    language?: string;
}

function pickPreferredAudioTrackIndex(
    tracks: { length: number; [i: number]: AudioTrackInfo },
    preferredAudioLang?: string | null,
    originalLanguageCode?: string | null
): number {
    let chosenIndex = 0;

    const userLang = normalizeLangCode(preferredAudioLang);
    if (userLang && tracks.length > 0) {
        for (let i = 0; i < tracks.length; i++) {
            const trackLang = normalizeLangCode(tracks[i]?.language);
            if (trackLang && trackLang === userLang) {
                chosenIndex = i;
                break;
            }
        }
    }

    if (chosenIndex === 0) {
        const targetLang = normalizeLangCode(originalLanguageCode);
        if (targetLang && tracks.length > 0) {
            for (let i = 0; i < tracks.length; i++) {
                const trackLang = normalizeLangCode(tracks[i]?.language);
                if (trackLang && trackLang === targetLang) {
                    chosenIndex = i;
                    break;
                }
            }
        }
    }

    if (chosenIndex === 0 && tracks.length > 1) {
        let originalIndex = 0;
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i]?.enabled) {
                originalIndex = i;
                break;
            }
        }

        if (!tracks[originalIndex]?.enabled) {
            const labelLower = (tracks[originalIndex]?.label ?? "").toLowerCase();
            if (!labelLower.includes("original") && !labelLower.includes("default")) {
                for (let i = 0; i < tracks.length; i++) {
                    const trackLabel = (tracks[i]?.label ?? "").toLowerCase();
                    if (trackLabel.includes("original") || trackLabel.includes("default")) {
                        originalIndex = i;
                        break;
                    }
                }
            }
        }

        chosenIndex = originalIndex;
    }

    return chosenIndex;
}

async function resolveAddonStreamUrl(downloadUrl: string): Promise<{ url?: string; status?: number } | null> {
    const endpoint = `/api/addon/resolve?url=${encodeURIComponent(downloadUrl)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(endpoint);
            if (response.ok) {
                return await response.json() as { url?: string; status?: number };
            }
        } catch {
            // Retry transient network failures with backoff.
        }
        if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
    }
    return null;
}


export interface LegacyVideoPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    streamingLinks?: Record<string, string>;
    subtitles?: AddonSubtitle[];
    /** Progress tracking key for continue watching feature */
    progressKey?: ProgressKey;
    /** Initial seek position in seconds (from progress restore) */
    startFromSeconds?: number;
    onNext?: () => void;
    onPrev?: () => void;
    onPreload?: () => void;
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

const LOADING_HINT_AFTER_MS = 12000;

/** Compact device-sync cast button for the video player control bar */
function PlayerCastButton({
    videoRef,
    downloadUrl,
    title,
    subtitles,
}: {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    downloadUrl: string;
    title: string;
    subtitles?: AddonSubtitle[];
}) {
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const devices = useDeviceSyncStore((s) => s.devices);
    const activeTarget = useDeviceSyncStore((s) => s.activeTarget);
    const connectionStatus = useDeviceSyncStore((s) => s.connectionStatus);
    const setActiveTarget = useDeviceSyncStore((s) => s.setActiveTarget);
    const transferPlayback = useDeviceSyncStore((s) => s.transferPlayback);

    if (!enabled || connectionStatus !== "connected") return null;

    const isRemoteActive = activeTarget !== null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    className={cn(PLAYER_BTN_SM)}
                    aria-label="Cast to device">
                    <Cast className={cn("h-5 w-5", isRemoteActive && "text-primary")} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                side="top"
                className="min-w-[200px] z-[100] bg-black/90 text-white border-white/10 backdrop-blur-md p-1">
                <DropdownMenuLabel className="text-[10px] tracking-widest uppercase text-white/40 px-3 py-2">
                    Play on
                </DropdownMenuLabel>
                {/* This device */}
                <DropdownMenuItem
                    onClick={() => setActiveTarget(null)}
                    className={cn("focus:bg-white/10 focus:text-white", !isRemoteActive && "text-primary")}>
                    This device {!isRemoteActive && "✓"}
                </DropdownMenuItem>
                {/* Other devices */}
                {devices.map((device) => (
                    <DropdownMenuItem
                        key={device.id}
                        onClick={() => {
                            setActiveTarget(device.id);
                            const video = videoRef.current;
                            transferPlayback(device.id, {
                                url: downloadUrl,
                                title,
                                subtitles: subtitles?.map((s) => ({ url: s.url, lang: s.lang, name: s.name })),
                                progressSeconds: video?.currentTime,
                                durationSeconds: video?.duration,
                            });
                        }}
                        className={cn("focus:bg-white/10 focus:text-white", activeTarget === device.id && "text-primary")}>
                        {device.name} {activeTarget === device.id && "✓"}
                    </DropdownMenuItem>
                ))}
                {devices.length === 0 && (
                    <DropdownMenuItem className="focus:bg-transparent text-white/40 cursor-default" onSelect={(e) => e.preventDefault()}>
                        No other devices online
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

const PLAYER_BTN = "inline-flex items-center justify-center rounded-full text-white bg-transparent border-none cursor-pointer shrink-0 transition-all duration-150 hover:bg-white/15 active:scale-90 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent";
const PLAYER_BTN_SM = `${PLAYER_BTN} w-9 h-9`;
const PLAYER_BTN_MD = `${PLAYER_BTN} w-10 h-10`;
const POPUP_STYLE: React.CSSProperties = { background: "rgba(15,15,15,0.95)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)" };
const POPUP_CLS = "player-popup rounded-lg text-white";
const POPUP_LABEL = "player-popup-label text-[10px] tracking-[0.15em] uppercase text-white/40 px-3.5 pt-2.5 pb-1.5 select-none";
const POPUP_ITEM = "player-popup-item relative flex items-center gap-2.5 w-full px-3.5 py-2 text-[13px] text-white/85 bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-white/[0.08] hover:text-white";
const POPUP_DIVIDER = "player-popup-divider h-px bg-white/[0.08] my-1";

/** Native HTML5 video player. iOS: tap-to-play (no autoplay), loading timeout hint. Windows: unchanged. */
export function LegacyVideoPreview({ file, downloadUrl, streamingLinks, subtitles, progressKey, startFromSeconds, onNext, onPrev, onPreload, onLoad, onError }: LegacyVideoPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hasPreloaded = useRef(false);
    const [error, setError] = useState(false);
    const [showCodecWarning, setShowCodecWarning] = useState(true);
    const [showHelp, setShowHelp] = useState(false);
    const [showRemainingTime, setShowRemainingTime] = useState(false);
    const ios = isIOS();
    const [iosTapToPlay, setIosTapToPlay] = useState(ios);
    const [showLoadingHint, setShowLoadingHint] = useState(false);
    const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [canStartPlayback, setCanStartPlayback] = useState(false);
    const [audioTrackCount, setAudioTrackCount] = useState(0);
    const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);
    const [subtitleSize, setSubtitleSize] = useState(
        () => useSettingsStore.getState().settings.playback.subtitleSize
    );
    const [subtitlePosition, setSubtitlePosition] = useState(
        () => useSettingsStore.getState().settings.playback.subtitlePosition
    );
    const [subtitleDelay, setSubtitleDelay] = useState(0); // ms, negative = earlier, positive = later
    const [subtitleBackground, setSubtitleBackground] = useState<'solid' | 'semi' | 'outline' | 'none'>(
        () => useSettingsStore.getState().settings.playback.subtitleBackground ?? 'semi'
    );
    const [subtitleColor, setSubtitleColor] = useState(
        () => useSettingsStore.getState().settings.playback.subtitleColor ?? '#ffffff'
    );
    const [subtitleFont, setSubtitleFont] = useState<'default' | 'mono' | 'serif' | 'trebuchet'>(
        () => useSettingsStore.getState().settings.playback.subtitleFont ?? 'default'
    );
    const [playbackRate, setPlaybackRate] = useState(
        () => useSettingsStore.getState().settings.playback.playbackSpeed
    );
    const [isLoading, setIsLoading] = useState(true);

    // User's preferred subtitle language from settings
    const preferredSubLang = useSettingsStore((s) => s.settings.playback.subtitleLanguage);
    // User's preferred audio language from streaming settings
    const preferredAudioLang = useSettingsStore((s) => s.settings.streaming.preferredLanguage);
    // IntroDB: auto-skip intro/recap/outro
    const autoSkipIntro = useSettingsStore((s) => s.settings.playback.autoSkipIntro);
    const { data: introSegments } = useIntroSegments(progressKey);
    // Track which segments have been auto-skipped (reset on new episode)
    const skippedSegmentsRef = useRef<Set<string>>(new Set());
    // Active skip-prompt segment: null | 'intro' | 'recap' | 'outro'
    const [activeSkipSegment, setActiveSkipSegment] = useState<'intro' | 'recap' | 'outro' | null>(null);
    // Grace-period timer: keep skip button visible 5s after exiting a segment
    const skipGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Manual subtitle rendering (bypasses Windows OS caption override)
    const [parsedCues, setParsedCues] = useState<SubtitleCue[][]>([]);
    const [activeCueText, setActiveCueText] = useState<string>("");

    // In-player OSD (on-screen display) for keyboard feedback
    const [osdText, setOsdText] = useState("");
    const [osdVisible, setOsdVisible] = useState(false);
    type OsdPosition = "top-right" | "center" | "left" | "right";
    const [osdPosition, setOsdPosition] = useState<OsdPosition>("top-right");
    const osdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Accumulates total seek distance while a seek key is held
    const seekAccRef = useRef<{ direction: 1 | -1; total: number } | null>(null);
    // Auto-next episode countdown
    const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const onNextRef = useRef(onNext);
    onNextRef.current = onNext;
    // Seekbar hover tooltip
    const [seekHoverPct, setSeekHoverPct] = useState<number | null>(null);
    // Custom seekbar drag state
    const seekbarRef = useRef<HTMLDivElement>(null);
    const [isDraggingSeekbar, setIsDraggingSeekbar] = useState(false);
    const wasPausedBeforeDragRef = useRef(false);
    // Center action icon (YouTube-style play/pause flash)
    const [centerAction, setCenterAction] = useState<"play" | "pause" | null>(null);
    const centerActionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Seek ripple
    const [seekRipple, setSeekRipple] = useState<{ dir: "left" | "right"; key: number } | null>(null);
    const seekRippleKeyRef = useRef(0);

    const showCenterAction = useCallback((action: "play" | "pause") => {
        if (centerActionTimeoutRef.current) clearTimeout(centerActionTimeoutRef.current);
        setCenterAction(action);
        centerActionTimeoutRef.current = setTimeout(() => setCenterAction(null), 600);
    }, []);

    const triggerSeekRipple = useCallback((dir: "left" | "right") => {
        seekRippleKeyRef.current += 1;
        setSeekRipple({ dir, key: seekRippleKeyRef.current });
        setTimeout(() => setSeekRipple(null), 600);
    }, []);

    const showOsd = useCallback((text: string, position: OsdPosition = "top-right") => {
        setOsdText(text);
        setOsdVisible(true);
        setOsdPosition(position);
        if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
        osdTimeoutRef.current = setTimeout(() => {
            setOsdVisible(false);
            seekAccRef.current = null;
        }, 1000);
    }, []);

    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTapRef = useRef<{ time: number; x: number } | null>(null);
    const [bufferedPercent, setBufferedPercent] = useState(0);

    const cancelAutoNext = useCallback(() => {
        if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
        }
        setAutoNextCountdown(null);
    }, []);

    // Control bar auto-hide
    const [showControls, setShowControls] = useState(true);
    const [useCompactControls, setUseCompactControls] = useState(false);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hasCodecIssue = isNonMP4Video(file.name);

    // Smart streaming URL selection based on browser codec support
    // Uses transcoded streams when native format likely won't work
    const streamingSelection = useMemo(() => {
        return selectBestStreamingUrl(downloadUrl, streamingLinks, file.name);
    }, [downloadUrl, streamingLinks, file.name]);

    const effectiveUrl = streamingSelection.url;
    const isUsingTranscodedStream = streamingSelection.isTranscoded;

    // Track if we've tried fallback to transcoded stream
    const [triedTranscodeFallback, setTriedTranscodeFallback] = useState(false);
    const [useDirectUrl, _setUseDirectUrl] = useState(false);

    // Track if we've tried server-side URL resolution (for addon redirect URLs)
    const triedUrlResolveRef = useRef(false);

    // Final URL: if user requested direct, use download URL; otherwise use smart selection
    const finalUrl = useDirectUrl ? downloadUrl : effectiveUrl;

    // Suppress warning if we're using a transcoded stream
    // Check if we have an HLS stream available
    const isHls = !!streamingLinks?.apple;
    const shouldShowWarning = hasCodecIssue && !isHls && !isUsingTranscodedStream;

    const openInExternalPlayer = useCallback(
        (player: MediaPlayer) => {
            videoRef.current?.pause();
            openInPlayer({ url: downloadUrl, fileName: file.name, player });
            setShowCodecWarning(false);
            setShowLoadingHint(false);
        },
        [downloadUrl, file.name]
    );

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [loop, setLoop] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number | -1>(-1); // Default to off, but will auto-enable
    // Tracks whether the user has explicitly chosen a subtitle track (including "Off").
    // When set, auto-enable effects are skipped so user intent is preserved.
    const userSetSubtitleRef = useRef(false);

    // Progress tracking for continue watching
    const { initialProgress, updateProgress, forceSync, markCompleted } = useProgress(progressKey ?? null);
    const { scrobble } = useTraktScrobble(progressKey ?? null);
    const lastProgressUpdateRef = useRef<number>(0);
    const lastUiTimeUpdateRef = useRef<number>(0);
    const lastSeekSyncAtRef = useRef<number>(0);
    const pendingSeekSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastErrorToastAtRef = useRef<number>(0);
    const debugEventStatsRef = useRef({ timeUpdates: 0, seeked: 0, syncWrites: 0 });
    const hasSeenkedToInitialRef = useRef(false);
    const hasShownResumeToastRef = useRef(false);
    const hasMarkedCompletedRef = useRef(false);
    const historySessionIdRef = useRef<string>("sess_init");
    const lastHistoryEmitRef = useRef<{ at: number; progress: number } | null>(null);
    const PROGRESS_UPDATE_INTERVAL = 5000; // Update localStorage every 5 seconds
    const UI_TIME_UPDATE_INTERVAL = 250; // Limit time-label/seekbar rerenders to ~4fps
    const SEEK_SYNC_MIN_INTERVAL = 1200;
    // Minimum fraction of total duration the user must have actually played before
    // a seek-to-end (position > 95%) is counted as completion. Prevents marking an
    // episode done when the user merely scrubs to the last few seconds to preview it.
    const COMPLETION_MIN_WATCH_FRACTION = 0.3;

    // Track actual wall-clock watch time (excludes time spent seeking/paused).
    // Used to prevent a simple seek-to-end from triggering "episode completed".
    const watchStartRef = useRef<number | null>(null);
    const watchedTimeRef = useRef<number>(0);

    useEffect(() => {
        if (historySessionIdRef.current !== "sess_init") return;
        historySessionIdRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `sess_${Date.now()}`;
    }, []);

    // Capture ? key before the global shortcuts dialog can handle it.
    // Uses capture phase on document to fire before any bubble-phase handlers.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
            if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                setShowHelp((v) => !v);
            }
        };
        document.addEventListener("keydown", handler, true);
        return () => document.removeEventListener("keydown", handler, true);
    }, []);

    // Reset skipped-segment tracking whenever the episode changes
    const prevProgressKeyRef = useRef(progressKey);
    useEffect(() => {
        if (prevProgressKeyRef.current !== progressKey) {
            prevProgressKeyRef.current = progressKey;
            skippedSegmentsRef.current = new Set();
            hasMarkedCompletedRef.current = false;
            hasShownResumeToastRef.current = false;
            historySessionIdRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `sess_${Date.now()}`;
            lastHistoryEmitRef.current = null;
            if (skipGraceTimerRef.current) {
                clearTimeout(skipGraceTimerRef.current);
                skipGraceTimerRef.current = null;
            }
            setActiveSkipSegment(null);
            // Reset actual watch-time counters for the new episode
            watchedTimeRef.current = 0;
            watchStartRef.current = null;
            // Reset subtitle state to avoid carrying stale cues/tracks across media.
            setParsedCues([]);
            setActiveCueText("");
            setActiveSubtitleIndex(-1);
            userSetSubtitleRef.current = false;
        }
    }, [progressKey]);

    const applyResumePosition = useCallback((seekTo: number | null | undefined): boolean => {
        const video = videoRef.current;
        if (!video || !seekTo || seekTo <= 0 || !Number.isFinite(video.duration)) return false;
        if (seekTo >= video.duration - 5) return false;

        video.currentTime = seekTo;
        if (!hasShownResumeToastRef.current) {
            hasShownResumeToastRef.current = true;
            const mins = Math.floor(seekTo / 60);
            const secs = Math.floor(seekTo % 60);
            showOsd(`Resumed ${mins}:${secs.toString().padStart(2, "0")}`);
        }
        return true;
    }, [showOsd]);

    const showLoadErrorToast = useCallback((message: string) => {
        const now = Date.now();
        if (now - lastErrorToastAtRef.current < 3000) return;
        lastErrorToastAtRef.current = now;
        toast.error("Failed to load video", {
            description: message,
            duration: 5000,
        });
    }, []);

    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        const timer = setInterval(() => {
            const stats = debugEventStatsRef.current;
            if (stats.timeUpdates === 0 && stats.seeked === 0 && stats.syncWrites === 0) return;
            console.debug("[legacy-player] event stats", { ...stats });
            debugEventStatsRef.current = { timeUpdates: 0, seeked: 0, syncWrites: 0 };
        }, 20_000);
        return () => clearInterval(timer);
    }, []);

    const emitHistory = useCallback((eventType: "pause" | "stop" | "complete" | "session_end", force = false) => {
        if (!progressKey) return;
        const video = videoRef.current;
        if (!video) return;

        const progressSeconds = Math.round(video.currentTime || 0);
        const durationSeconds = Math.round(video.duration || 0);
        if (!Number.isFinite(progressSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            return;
        }

        const minProgress = Math.min(10, durationSeconds * 0.02);
        if (progressSeconds < minProgress) return;

        const now = Date.now();
        const previous = lastHistoryEmitRef.current;
        const progressedEnough = !previous || progressSeconds - previous.progress >= 15;
        const oldEnough = !previous || now - previous.at >= 45_000;

        if (!force && !progressedEnough && !oldEnough) {
            return;
        }

        lastHistoryEmitRef.current = { at: now, progress: progressSeconds };

        fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imdbId: progressKey.imdbId,
                type: progressKey.type,
                season: progressKey.season,
                episode: progressKey.episode,
                fileName: file.name,
                progressSeconds,
                durationSeconds,
                eventType,
                sessionId: historySessionIdRef.current,
            }),
            keepalive: eventType === "session_end" || eventType === "stop" || eventType === "complete",
        }).catch(() => { });
    }, [progressKey, file.name]);

    // Original language from Trakt metadata (e.g. "en", "ja")
    const { data: originalLanguageCode } = useQuery({
        queryKey: ["trakt", "original-language", progressKey?.imdbId, progressKey?.type],
        queryFn: async () => {
            if (!progressKey) return null;
            if (progressKey.type === "movie") {
                const media = await traktClient.getMovie(progressKey.imdbId);
                return media.language ?? null;
            }
            const media = await traktClient.getShow(progressKey.imdbId);
            return media.language ?? null;
        },
        enabled: !!progressKey?.imdbId,
        staleTime: 24 * 60 * 60 * 1000,
    });

    const handleLoad = useCallback(() => {
        setIsLoading(false);
        if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
        }
        setShowLoadingHint(false);

        // Seek to saved progress on first load
        const video = videoRef.current;
        if (video && !hasSeenkedToInitialRef.current) {
            hasSeenkedToInitialRef.current = true;
            applyResumePosition(startFromSeconds ?? initialProgress);
        }

        // Auto-enable subtitle track matching user's preferred language (only if user hasn't set a preference)
        if (!userSetSubtitleRef.current && subtitles && subtitles.length > 0 && activeSubtitleIndex === -1 && preferredSubLang) {
            const langIndex = subtitles.findIndex((s) => isSubtitleLanguage(s, preferredSubLang));
            const bestIndex = langIndex !== -1 ? langIndex : subtitles.findIndex((s) => s.url);

            if (bestIndex !== -1) {
                setActiveSubtitleIndex(bestIndex);
            }
        }

        onLoad?.();
    }, [onLoad, startFromSeconds, initialProgress, subtitles, activeSubtitleIndex, preferredSubLang, applyResumePosition]);

    // Cross-device resume: if server progress arrives after the video has already loaded
    // and the user hasn't watched much yet (< 5s), apply the position now.
    useEffect(() => {
        if (initialProgress === null || !hasSeenkedToInitialRef.current) return;
        const video = videoRef.current;
        if (!video || video.currentTime >= 5) return;
        if (initialProgress > 5) applyResumePosition(initialProgress);
    }, [initialProgress, applyResumePosition]);

    // Watch for subtitles arriving later (e.g. from async fetch)
    useEffect(() => {
        if (!userSetSubtitleRef.current && subtitles?.length && activeSubtitleIndex === -1 && !isLoading && preferredSubLang) {
            const langIndex = subtitles.findIndex((s) => isSubtitleLanguage(s, preferredSubLang));
            const bestIndex = langIndex !== -1 ? langIndex : subtitles.findIndex((s) => s.url);

            if (bestIndex !== -1) {
                setActiveSubtitleIndex(bestIndex);
            }
        }
    }, [subtitles, activeSubtitleIndex, isLoading, preferredSubLang]);

    const handleError = useCallback(() => {
        setIsLoading(false);
        if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
        }
        setShowLoadingHint(false);
        
        // If we haven't tried transcoded stream yet and one is available, try it
        if (!triedTranscodeFallback && streamingLinks && Object.keys(streamingLinks).length > 0 && !isUsingTranscodedStream) {
            setTriedTranscodeFallback(true);
            setIsLoading(true);
            
            // Force use of a transcoded stream
            const transcodedUrl = streamingLinks.liveMP4 || streamingLinks.apple || streamingLinks.h264WebM || streamingLinks.dash;
            if (transcodedUrl && transcodedUrl !== effectiveUrl) {
                showOsd("Switching to compatible stream");
                // Reset the video element with the transcoded URL
                const video = videoRef.current;
                if (video) {
                    video.src = transcodedUrl;
                    video.load();
                    video.play().catch(() => {});
                }
                return;
            }
        }
        
        // For addon streams (no transcoded links): try resolving URL server-side.
        // Many addons return proxy/redirect URLs that fail in the browser's <video> element.
        if (!triedUrlResolveRef.current && (!streamingLinks || Object.keys(streamingLinks).length === 0)) {
            triedUrlResolveRef.current = true;
            setIsLoading(true);

            resolveAddonStreamUrl(downloadUrl)
                .then(data => {
                    const resolvedUrl = data?.url;
                    if (resolvedUrl && resolvedUrl !== downloadUrl && (data?.status ?? 999) < 400) {
                        showOsd("Retrying stream URL");
                        const video = videoRef.current;
                        if (video) {
                            video.src = resolvedUrl;
                            video.load();
                            video.play().catch(() => {});
                        }
                        return;
                    }
                    // Resolution didn't produce a different URL — show error
                    setError(true);
                    setIsLoading(false);
                    showLoadErrorToast("The video could not be loaded. Try an external player like VLC.");
                    onError?.(new Error("Failed to load video"));
                })
                .catch(() => {
                    setError(true);
                    setIsLoading(false);
                    showLoadErrorToast("The video could not be loaded. Try an external player like VLC.");
                    onError?.(new Error("Failed to load video"));
                });
            return;
        }

        setError(true);
        const errorMessage = "Failed to load video";
        showLoadErrorToast(
            hasCodecIssue
                ? "This video format isn't supported by your browser. Try opening in an external player like VLC."
                : "The video could not be loaded. This might be due to an unsupported format or a network issue."
        );
        onError?.(new Error(errorMessage));
    }, [onError, triedTranscodeFallback, streamingLinks, isUsingTranscodedStream, effectiveUrl, hasCodecIssue, downloadUrl, showOsd, showLoadErrorToast]);

    const handleLoadedMetadata = useCallback(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: AudioTrackInfo };
        }) | null;
        if (el?.audioTracks) {
            setAudioTrackCount(el.audioTracks.length);
            const chosenIndex = pickPreferredAudioTrackIndex(el.audioTracks, preferredAudioLang, originalLanguageCode);
            setSelectedAudioIndex(chosenIndex);
        }
        if (el) {
            setDuration(el.duration || 0);
            if (hasSeenkedToInitialRef.current) {
                // On transcode fallback/source switch, prefer the user's current
                // playback position over the initial resume point — the user may
                // have watched further since the original seek.
                const currentPos = el.currentTime;
                const seekTarget = currentPos && currentPos > 5
                    ? currentPos
                    : (startFromSeconds ?? initialProgress);
                applyResumePosition(seekTarget);
            }
            // Restore saved volume from localStorage
            const savedVol = localStorage.getItem("debridui-volume");
            if (savedVol !== null) {
                const v = Math.min(1, Math.max(0, parseFloat(savedVol)));
                el.volume = v;
            }
            setVolume(el.volume);
            setIsMuted(el.muted);
        }
    }, [originalLanguageCode, preferredAudioLang, startFromSeconds, initialProgress, applyResumePosition]);



    // Auto-select original audio track when tracks become available (fallback for async loading)
    useEffect(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: { enabled: boolean; label?: string; language?: string } };
        }) | null;
        if (!el?.audioTracks || el.audioTracks.length <= 1 || selectedAudioIndex !== 0) return;
        
        // Only run if we're still on default (index 0) and tracks are now available
        const tracks = el.audioTracks;
        let originalIndex = 0;
        
        // Check if any track is already enabled (browser default)
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i]?.enabled) {
                originalIndex = i;
                break;
            }
        }
        
        // If no enabled track found, look for "original" or "default" in label
        if (!tracks[originalIndex]?.enabled) {
            const labelLower = (tracks[originalIndex]?.label ?? "").toLowerCase();
            if (!labelLower.includes("original") && !labelLower.includes("default")) {
                for (let i = 0; i < tracks.length; i++) {
                    const trackLabel = (tracks[i]?.label ?? "").toLowerCase();
                    if (trackLabel.includes("original") || trackLabel.includes("default")) {
                        originalIndex = i;
                        break;
                    }
                }
            }
        }
        
        // Only update if different from current selection
        if (originalIndex !== 0) {
            setSelectedAudioIndex(originalIndex);
        }
    }, [audioTrackCount, selectedAudioIndex]);

    useEffect(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: { enabled: boolean } };
        }) | null;
        if (!el?.audioTracks) return;
        const tracks = el.audioTracks;
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = selectedAudioIndex === i;
        }

        const ensureSelected = () => {
            if (!tracks[selectedAudioIndex]?.enabled) {
                for (let i = 0; i < tracks.length; i++) {
                    tracks[i].enabled = false;
                }
                if (tracks[selectedAudioIndex]) {
                    tracks[selectedAudioIndex].enabled = true;
                }
            }
        };

        const timer = setTimeout(ensureSelected, 50);
        return () => clearTimeout(timer);
    }, [selectedAudioIndex, audioTrackCount]);

    useEffect(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };
        }) | null;
        if (!el?.audioTracks || !el.audioTracks.addEventListener || !el.audioTracks.removeEventListener) return;

        const syncCount = () => setAudioTrackCount(el.audioTracks?.length ?? 0);
        el.audioTracks.addEventListener("addtrack", syncCount);
        el.audioTracks.addEventListener("removetrack", syncCount);
        el.audioTracks.addEventListener("change", syncCount);

        return () => {
            el.audioTracks?.removeEventListener?.("addtrack", syncCount);
            el.audioTracks?.removeEventListener?.("removetrack", syncCount);
            el.audioTracks?.removeEventListener?.("change", syncCount);
        };
    }, []);

    useEffect(() => {
        if (activeSubtitleIndex < 0 || !subtitles?.length) return;
        if (activeSubtitleIndex >= subtitles.length) {
            setActiveSubtitleIndex(subtitles.length - 1);
        }
    }, [activeSubtitleIndex, subtitles]);

    // Sync basic media state for custom controls.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onPlay = () => {
            setIsPlaying(true);
            setIsLoading(false);
            // Trakt scrobble start
            const dur = video.duration || 0;
            if (Number.isFinite(dur) && dur > 0) scrobble("start", (video.currentTime / dur) * 100);
        };
        const onPause = () => {
            setIsPlaying(false);
            // Accumulate elapsed watch time when the video pauses (includes seeking)
            if (watchStartRef.current !== null) {
                watchedTimeRef.current += (Date.now() - watchStartRef.current) / 1000;
                watchStartRef.current = null;
            }
            // Sync progress to DB on pause
            forceSync("play_pause", "pause");
            emitHistory("pause");
            // Trakt scrobble pause
            const dur = video.duration || 0;
            if (Number.isFinite(dur) && dur > 0) scrobble("pause", (video.currentTime / dur) * 100);
        };
        const onTimeUpdate = () => {
            debugEventStatsRef.current.timeUpdates += 1;
            const time = video.currentTime || 0;
            const dur = video.duration || 0;
            const now = Date.now();
            if (now - lastUiTimeUpdateRef.current >= UI_TIME_UPDATE_INTERVAL) {
                lastUiTimeUpdateRef.current = now;
                setCurrentTime(time);
            }
            if (Number.isFinite(dur) && dur > 0) {
                setDuration((prev) => (prev > 0 ? prev : dur));
            }

            // Preload next episode at outro start (if available) or 90%
            const outroSec = introSegments?.outro?.start_sec;
            const preloadThreshold = outroSec ?? (dur > 0 ? dur * 0.9 : Infinity);
            if (dur > 0 && time >= preloadThreshold && !hasPreloaded.current) {
                hasPreloaded.current = true;
                onPreload?.();
            }

            // IntroDB: detect active segment + auto-skip
            if (introSegments) {
                let detected: 'intro' | 'recap' | 'outro' | null = null;
                for (const type of ['intro', 'recap', 'outro'] as const) {
                    const seg = introSegments[type];
                    if (seg && time >= seg.start_sec && time < seg.end_sec) {
                        if (!skippedSegmentsRef.current.has(type)) {
                            detected = type;
                            if (autoSkipIntro) {
                                skippedSegmentsRef.current.add(type);
                                video.currentTime = seg.end_sec;
                            }
                        }
                        break;
                    }
                }
                if (detected) {
                    // Inside segment: show button, clear any grace timer
                    if (skipGraceTimerRef.current) {
                        clearTimeout(skipGraceTimerRef.current);
                        skipGraceTimerRef.current = null;
                    }
                    setActiveSkipSegment(detected);
                } else {
                    // Outside segment: keep button for 5s grace period then hide
                    if (!skipGraceTimerRef.current) {
                        skipGraceTimerRef.current = setTimeout(() => {
                            skipGraceTimerRef.current = null;
                            setActiveSkipSegment(null);
                        }, 5000);
                    }
                }
            }

            // Update progress in localStorage (throttled)
            // Guard: skip when duration is invalid (NaN before metadata, Infinity for transcoded streams)
            if (progressKey && Number.isFinite(dur) && dur > 0 && now - lastProgressUpdateRef.current >= PROGRESS_UPDATE_INTERVAL) {
                lastProgressUpdateRef.current = now;
                debugEventStatsRef.current.syncWrites += 1;
                updateProgress(time, dur);
            }

            // Mark completed at 95% — only if the user has genuinely watched
            // at least 30% of the total duration (guards against a simple seek-to-end).
            // onEnded always marks complete regardless of this threshold.
            if (progressKey && dur > 0 && time / dur > 0.95 && !hasMarkedCompletedRef.current) {
                if (watchedTimeRef.current >= dur * COMPLETION_MIN_WATCH_FRACTION) {
                    hasMarkedCompletedRef.current = true;
                    markCompleted();
                    emitHistory("complete", true);
                }
            }
        };
        const onWaiting = () => {
            setIsLoading(true);
        };
        const onPlaying = () => {
            setIsLoading(false);
            setIsPlaying(true);
            // Start (or resume) the actual watch-time timer
            watchStartRef.current = Date.now();
        };
        const onDurationChange = () => setDuration(video.duration || 0);
        const onSeeked = () => {
            debugEventStatsRef.current.seeked += 1;
            // Coalesce rapid scrub seeks into fewer writes while keeping the final position durable.
            const now = Date.now();
            const elapsed = now - lastSeekSyncAtRef.current;
            if (elapsed >= SEEK_SYNC_MIN_INTERVAL) {
                lastSeekSyncAtRef.current = now;
                debugEventStatsRef.current.syncWrites += 1;
                forceSync("play_progress", "seeked");
                return;
            }

            if (pendingSeekSyncTimerRef.current) clearTimeout(pendingSeekSyncTimerRef.current);
            pendingSeekSyncTimerRef.current = setTimeout(() => {
                lastSeekSyncAtRef.current = Date.now();
                debugEventStatsRef.current.syncWrites += 1;
                forceSync("play_progress", "seeked_coalesced");
                pendingSeekSyncTimerRef.current = null;
            }, SEEK_SYNC_MIN_INTERVAL - elapsed);
        };
        const onVolumeChange = () => {
            setVolume(video.volume);
            setIsMuted(video.muted || video.volume === 0);
            // Persist non-muted volume so it survives reload
            if (!video.muted && video.volume > 0) {
                localStorage.setItem("debridui-volume", String(video.volume));
            }
        };
        const onEnded = () => {
            // Flush any remaining watch time accumulated since the last pause
            if (watchStartRef.current !== null) {
                watchedTimeRef.current += (Date.now() - watchStartRef.current) / 1000;
                watchStartRef.current = null;
            }
            // Trakt scrobble stop (progress >= 80% → Trakt marks as watched)
            scrobble("stop", 100);
            // Mark as completed when video ends (> 95% watched)
            if (progressKey) {
                if (!hasMarkedCompletedRef.current) {
                    hasMarkedCompletedRef.current = true;
                    markCompleted();
                }
                forceSync("play_complete", "ended");
                emitHistory("complete", true);
            }
            // Auto-next if available — with 5-second countdown
            if (onNext) {
                const cb = onNext;
                setAutoNextCountdown(5);
                let remaining = 5;
                countdownTimerRef.current = setInterval(() => {
                    remaining--;
                    if (remaining <= 0) {
                        clearInterval(countdownTimerRef.current!);
                        countdownTimerRef.current = null;
                        setAutoNextCountdown(null);
                        cb();
                    } else {
                        setAutoNextCountdown(remaining);
                    }
                }, 1000);
            }
        };

        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("playing", onPlaying);
        video.addEventListener("durationchange", onDurationChange);
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("volumechange", onVolumeChange);
        video.addEventListener("ended", onEnded);

        const onVisibilityChange = () => {
            if (document.hidden) {
                forceSync("session_end", "visibility_hidden");
                emitHistory("session_end", true);
            }
        };
        const onPageHide = () => {
            forceSync("session_end", "pagehide");
            emitHistory("session_end", true);
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("pagehide", onPageHide);

        return () => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("waiting", onWaiting);
            video.removeEventListener("playing", onPlaying);
            video.removeEventListener("durationchange", onDurationChange);
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("volumechange", onVolumeChange);
            video.removeEventListener("ended", onEnded);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("pagehide", onPageHide);
            forceSync("play_stop", "unmount");
            emitHistory("stop", true);
            if (pendingSeekSyncTimerRef.current) {
                clearTimeout(pendingSeekSyncTimerRef.current);
                pendingSeekSyncTimerRef.current = null;
            }
            if (skipGraceTimerRef.current) {
                clearTimeout(skipGraceTimerRef.current);
                skipGraceTimerRef.current = null;
            }
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
                setAutoNextCountdown(null);
            }
        };
    }, [progressKey, updateProgress, forceSync, markCompleted, onNext, onPreload, scrobble, autoSkipIntro, introSegments, emitHistory]);

    // Track buffered range for seekbar visual feedback
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const update = () => {
            if (!video.duration) return;
            // Find the buffered range containing the current playback position
            const ct = video.currentTime;
            let end = ct; // Default to current time if no range found
            for (let i = 0; i < video.buffered.length; i++) {
                if (video.buffered.start(i) <= ct && ct <= video.buffered.end(i)) {
                    end = video.buffered.end(i);
                    break;
                }
            }
            setBufferedPercent((end / video.duration) * 100);
        };
        video.addEventListener("progress", update);
        video.addEventListener("timeupdate", update);
        video.addEventListener("seeked", update);
        return () => {
            video.removeEventListener("progress", update);
            video.removeEventListener("timeupdate", update);
            video.removeEventListener("seeked", update);
        };
    }, []);


    // Keep fullscreen state in sync (native + CSS fake fullscreen)
    const [fakeFullscreen, setFakeFullscreen] = useState(false);
    useEffect(() => {
        const handler = () => {
            const el = containerRef.current;
            const fsElement = document.fullscreenElement;
            setIsFullscreen(!!el && fsElement === el);
        };
        document.addEventListener("fullscreenchange", handler);
        return () => {
            document.removeEventListener("fullscreenchange", handler);
        };
    }, []);

    // Sync playback rate with video element
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.playbackRate = playbackRate;
    }, [playbackRate]);

    // Control bar auto-hide (3s inactivity) — freezes while a menu/popup is open
    const openMenuRef = useRef<string | null>(null);
    const resetControlsTimeout = useCallback(() => {
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        setShowControls(true);
        controlsTimeoutRef.current = setTimeout(() => {
            if (openMenuRef.current) return; // Don't hide while a menu is open
            if (videoRef.current && !videoRef.current.paused) {
                setShowControls(false);
            }
        }, 3000);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleActivity = () => resetControlsTimeout();
        container.addEventListener("mousemove", handleActivity);
        container.addEventListener("touchstart", handleActivity, { passive: true });
        container.addEventListener("click", handleActivity);

        // Start timer
        resetControlsTimeout();

        return () => {
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
            container.removeEventListener("mousemove", handleActivity);
            container.removeEventListener("touchstart", handleActivity);
            container.removeEventListener("click", handleActivity);
        };
    }, [resetControlsTimeout]);

    const togglePlay = useCallback(() => {
        const el = videoRef.current;
        if (!el) return;
        if (el.paused || el.ended) {
            showCenterAction("play");
            void el.play();
        } else {
            showCenterAction("pause");
            el.pause();
        }
    }, [showCenterAction]);

    const seekTo = useCallback((time: number) => {
        const el = videoRef.current;
        if (!el || !Number.isFinite(el.duration)) return;
        el.currentTime = Math.min(Math.max(time, 0), el.duration);
        setCurrentTime(el.currentTime);
    }, []);

    const _handleSeekChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) seekTo(value);
        },
        [seekTo]
    );

    // Custom seekbar pointer handlers
    const seekbarPctFromEvent = useCallback((e: PointerEvent | React.PointerEvent) => {
        const bar = seekbarRef.current;
        if (!bar) return 0;
        const rect = bar.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }, []);

    const handleSeekbarPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const pct = seekbarPctFromEvent(e);
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
        wasPausedBeforeDragRef.current = video.paused;
        video.pause();
        setIsDraggingSeekbar(true);
        seekTo(pct * video.duration);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [seekbarPctFromEvent, seekTo]);

    const handleSeekbarPointerMove = useCallback((e: React.PointerEvent) => {
        const bar = seekbarRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setSeekHoverPct(pct);
        if (isDraggingSeekbar) {
            const video = videoRef.current;
            if (video && Number.isFinite(video.duration) && video.duration > 0) {
                seekTo(pct * video.duration);
            }
        }
    }, [isDraggingSeekbar, seekTo]);

    const handleSeekbarPointerUp = useCallback((e: React.PointerEvent) => {
        if (!isDraggingSeekbar) return;
        setIsDraggingSeekbar(false);
        const pct = seekbarPctFromEvent(e);
        const video = videoRef.current;
        if (video && Number.isFinite(video.duration) && video.duration > 0) {
            seekTo(pct * video.duration);
            if (!wasPausedBeforeDragRef.current) {
                video.play().catch(() => {});
            }
        }
    }, [isDraggingSeekbar, seekbarPctFromEvent, seekTo]);

    const handleSeekbarPointerLeave = useCallback(() => {
        if (!isDraggingSeekbar) setSeekHoverPct(null);
    }, [isDraggingSeekbar]);

    const toggleMute = useCallback(() => {
        const el = videoRef.current;
        if (!el) return;
        el.muted = !el.muted;
        if (!el.muted && el.volume === 0) {
            el.volume = 0.5;
        }
    }, []);

    const handleVolumeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const el = videoRef.current;
        if (!el) return;
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        el.volume = Math.min(Math.max(value, 0), 1);
        el.muted = el.volume === 0;
    }, []);

    const toggleFullscreen = useCallback(async () => {
        const el = containerRef.current;
        if (!el) return;

        // Exit fake fullscreen if active
        if (fakeFullscreen) {
            setFakeFullscreen(false);
            setIsFullscreen(false);
            return;
        }

        const fsElement =
            document.fullscreenElement ||
            // @ts-expect-error - vendor-prefixed
            document.webkitFullscreenElement;
        if (!fsElement) {
            try {
                await el.requestFullscreen();
            } catch {
                // Fullscreen API rejected (no user gesture, e.g. remote command)
                // Fall back to CSS-based fullscreen
                setFakeFullscreen(true);
                setIsFullscreen(true);
            }
        } else if (document.exitFullscreen) {
            void document.exitFullscreen();
        }
    }, [fakeFullscreen]);

    // Click to play/pause (desktop only — mobile uses handleMobileTap)
    const handleContainerClick = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("[data-player-controls]")) return;
        // On touch devices, handleMobileTap manages taps — skip click handler
        if (useCompactControls) return;
        togglePlay();
    }, [togglePlay, useCompactControls]);

    // Mobile double-tap to seek \u00b110s (left half = back, right half = forward)
    const handleMobileTap = useCallback((e: React.TouchEvent) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        if ((e.target as HTMLElement).closest("[data-player-controls]")) return;
        const now = Date.now();
        const containerWidth = containerRef.current?.clientWidth ?? 1;
        const last = lastTapRef.current;
        if (last && now - last.time < 300 && Math.abs(touch.clientX - last.x) < 60) {
            if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
            const delta = touch.clientX < containerWidth / 2 ? -10 : 10;
            seekTo((videoRef.current?.currentTime ?? 0) + delta);
            triggerSeekRipple(delta < 0 ? "left" : "right");
            const dir: 1 | -1 = delta > 0 ? 1 : -1;
            if (seekAccRef.current?.direction === dir) { seekAccRef.current.total += Math.abs(delta); }
            else { seekAccRef.current = { direction: dir, total: Math.abs(delta) }; }
            showOsd(delta < 0 ? `\u00ab ${seekAccRef.current.total}s` : `\u00bb ${seekAccRef.current.total}s`, delta < 0 ? "left" : "right");
            lastTapRef.current = null;
        } else {
            lastTapRef.current = { time: now, x: touch.clientX };
            // Single-tap on mobile: toggle controls visibility after double-tap window
            if (useCompactControls) {
                if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                clickTimerRef.current = setTimeout(() => {
                    clickTimerRef.current = null;
                    setShowControls((v) => {
                        if (!v) resetControlsTimeout();
                        return !v;
                    });
                }, 300);
            }
        }
    }, [seekTo, showOsd, triggerSeekRipple, useCompactControls, resetControlsTimeout]);

    // Swipe gesture state: horizontal = seek, vertical = volume
    const touchSwipeRef = useRef<{
        startX: number; startY: number;
        startVolume: number; startPosition: number;
        axis: "horizontal" | "vertical" | null; swiping: boolean;
    } | null>(null);
    const [swipeSeekPreview, setSwipeSeekPreview] = useState<{ targetTime: number } | null>(null);
    // Long-press 2x speed boost on mobile
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressActiveRef = useRef(false);
    const longPressSavedRateRef = useRef(1);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if ((e.target as HTMLElement).closest("[data-player-controls]")) return;
        const el = videoRef.current;
        if (!el) return;
        const t = e.touches[0];
        touchSwipeRef.current = {
            startX: t.clientX, startY: t.clientY,
            startVolume: el.volume, startPosition: el.currentTime,
            axis: null, swiping: false,
        };
        // Long-press 2x speed boost
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
            if (!el.paused) {
                longPressSavedRateRef.current = el.playbackRate;
                el.playbackRate = 2;
                longPressActiveRef.current = true;
                showOsd("2× Speed", "center");
            }
        }, 500);
    }, [showOsd]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        const state = touchSwipeRef.current;
        if (!state) return;
        if ((e.target as HTMLElement).closest("[data-player-controls]")) return;
        // Cancel long-press once user starts swiping
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
        const t = e.touches[0];
        const dx = t.clientX - state.startX;
        const dy = t.clientY - state.startY;
        if (!state.axis) {
            if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
                state.axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
                state.swiping = true;
            }
            return;
        }
        const el = videoRef.current;
        if (!el) return;
        if (state.axis === "horizontal") {
            const w = containerRef.current?.clientWidth ?? 300;
            const delta = (dx / w) * 90;
            const secs = Math.abs(Math.round(delta));
            showOsd(delta > 0 ? `» ${secs}s` : `« ${secs}s`, delta > 0 ? "right" : "left");
            const dur = videoRef.current?.duration ?? 0;
            if (dur > 0) {
                setSwipeSeekPreview({ targetTime: Math.max(0, Math.min(dur, state.startPosition + delta)) });
            }
        } else {
            const h = containerRef.current?.clientHeight ?? 200;
            const newVol = Math.max(0, Math.min(1, state.startVolume - (dy / h)));
            el.volume = newVol;
            el.muted = newVol === 0;
            setVolume(newVol);
            setIsMuted(newVol === 0);
            showOsd(newVol === 0 ? "Muted" : `Volume ${Math.round(newVol * 100)}%`, "center");
        }
    }, [showOsd, setVolume, setIsMuted]);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        // Cancel long-press timer
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
        // Restore playback rate if long-press was active
        if (longPressActiveRef.current) {
            const el = videoRef.current;
            if (el) el.playbackRate = longPressSavedRateRef.current;
            longPressActiveRef.current = false;
        }
        const state = touchSwipeRef.current;
        touchSwipeRef.current = null;
        setSwipeSeekPreview(null);
        if (!state?.swiping) { handleMobileTap(e); return; }
        if (state.axis === "horizontal") {
            const t = e.changedTouches[0];
            const dx = t.clientX - state.startX;
            const w = containerRef.current?.clientWidth ?? 300;
            const newTime = Math.max(0, Math.min(
                videoRef.current?.duration ?? 0,
                state.startPosition + (dx / w) * 90
            ));
            seekTo(newTime);
        }
    }, [handleMobileTap, seekTo]);

    const [openMenu, setOpenMenu] = useState<"subtitles" | "audio" | "settings" | null>(null);
    const setOpenMenuTracked = useCallback((val: typeof openMenu) => {
        openMenuRef.current = val;
        setOpenMenu(val);
        if (val) resetControlsTimeout(); // Reset timer when opening a menu
    }, [resetControlsTimeout]);
    const [settingsPanel, setSettingsPanel] = useState<"speed" | "subtitles" | "players" | null>(null);

    // Close menus when control bar hides
    useEffect(() => {
        if (!showControls && openMenu) {
            setOpenMenuTracked(null);
            setSettingsPanel(null);
        }
    }, [showControls, openMenu, setOpenMenuTracked]);

    // Guard against rapid episode navigation clicks
    const navGuardRef = useRef(false);
    const guardedNav = useCallback((fn?: () => void) => {
        if (!fn || navGuardRef.current) return;
        navGuardRef.current = true;
        fn();
        setTimeout(() => { navGuardRef.current = false; }, 1000);
    }, []);

    // When subtitle selection changes, toggle textTracks modes (also disables embedded tracks).
    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        const tracks = el.textTracks;
        if (!tracks) return;

        const activeSub = activeSubtitleIndex >= 0 ? subtitles?.[activeSubtitleIndex] : undefined;
        const activeLabel = activeSub ? activeSub.name ?? activeSub.lang : undefined;

        // Expose active subtitle index to the device sync reporter via a data attribute
        el.dataset.activeSubtitle = String(activeSubtitleIndex);

        // Ensure we never show more than one subtitle/caption track at a time.
        // Some streams have embedded tracks with the same label/lang as addon tracks,
        // so we only activate the first matching track to avoid "dual subtitles".
        let activated = false;
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind !== "subtitles" && track.kind !== "captions") continue;
            track.mode = "disabled";
            if (!activeSub || activated) continue;
            if (track.label === activeLabel || (activeSub.lang && track.language === activeSub.lang)) {
                track.mode = "showing";
                activated = true;
            }
        }
    }, [activeSubtitleIndex, subtitles]);

    const formatTime = (value: number): string => {
        if (!Number.isFinite(value) || value < 0) return "0:00";
        const total = Math.floor(value);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
        const ss = String(s).padStart(2, "0");
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    };

    // Start loading timeout when video starts loading; show hint if it never reaches canplay
    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;

        const onLoadStart = () => {
            if (loadingTimeoutRef.current) return;
            loadingTimeoutRef.current = setTimeout(() => {
                setShowLoadingHint(true);
            }, LOADING_HINT_AFTER_MS);
        };

        el.addEventListener("loadstart", onLoadStart);
        return () => {
            el.removeEventListener("loadstart", onLoadStart);
            if (loadingTimeoutRef.current) {
                clearTimeout(loadingTimeoutRef.current);
                loadingTimeoutRef.current = null;
            }
        };
    }, []);

    const handleIosTapToPlay = useCallback(() => {
        setIosTapToPlay(false);
        videoRef.current?.play();
    }, []);

    // Keyboard shortcuts - YouTube-style controls:
    // Space/K: play/pause | Arrow Left/Right: ±5s | J/L: ±10s | ,/.: ±0.5s frame-step (paused)
    // Arrow Up/Down: volume | M: mute | F: fullscreen | C: cycle subtitles | [/]: speed
    // G/H: subtitle delay -/+500ms | N: next episode
    // R: loop toggle | P: picture-in-picture | Home: start | End: near-end | 0-9: seek %
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const active = document.activeElement;
            // Skip if user is typing in a text input (but not range/seekbar)
            if (
                active &&
                (active.tagName === "TEXTAREA" ||
                    (active as HTMLElement).isContentEditable ||
                    (active.tagName === "INPUT" && (active as HTMLInputElement).type !== "range"))
            ) {
                return;
            }

            // Prevent default on focused buttons so shortcuts work, without destroying focus
            if (
                active &&
                active !== document.body &&
                (active.tagName === "BUTTON" || (active as HTMLInputElement).type === "range")
            ) {
                event.preventDefault();
            }

            // Re-show controls on any keyboard shortcut
            resetControlsTimeout();

            switch (event.key) {
                case "Escape":
                    if (showHelp) {
                        event.preventDefault();
                        setShowHelp(false);
                        break;
                    }
                    if (autoNextCountdown !== null) {
                        event.preventDefault();
                        if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
                        setAutoNextCountdown(null);
                        break;
                    }
                    if (fakeFullscreen) {
                        event.preventDefault();
                        setFakeFullscreen(false);
                        setIsFullscreen(false);
                    }
                    break;
                case " ":
                case "k":
                case "K":
                    event.preventDefault();
                    togglePlay();
                    break;
                case "ArrowLeft": {
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) - 5);
                    triggerSeekRipple("left");
                    if (seekAccRef.current?.direction === -1) { seekAccRef.current.total += 5; }
                    else { seekAccRef.current = { direction: -1, total: 5 }; }
                    showOsd(`« ${seekAccRef.current.total}s`, "left");
                    break;
                }
                case "ArrowRight": {
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) + 5);
                    triggerSeekRipple("right");
                    if (seekAccRef.current?.direction === 1) { seekAccRef.current.total += 5; }
                    else { seekAccRef.current = { direction: 1, total: 5 }; }
                    showOsd(`» ${seekAccRef.current.total}s`, "right");
                    break;
                }
                case "j":
                case "J": {
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) - 10);
                    triggerSeekRipple("left");
                    if (seekAccRef.current?.direction === -1) { seekAccRef.current.total += 10; }
                    else { seekAccRef.current = { direction: -1, total: 10 }; }
                    showOsd(`« ${seekAccRef.current.total}s`, "left");
                    break;
                }
                case "l":
                case "L": {
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) + 10);
                    triggerSeekRipple("right");
                    if (seekAccRef.current?.direction === 1) { seekAccRef.current.total += 10; }
                    else { seekAccRef.current = { direction: 1, total: 10 }; }
                    showOsd(`» ${seekAccRef.current.total}s`, "right");
                    break;
                }
                case ",":
                case "<":
                    if (videoRef.current?.paused) {
                        event.preventDefault();
                        seekTo((videoRef.current?.currentTime ?? 0) - 0.5);
                        showOsd("−0.5s", "left");
                    }
                    break;
                case ".":
                case ">":
                    if (videoRef.current?.paused) {
                        event.preventDefault();
                        seekTo((videoRef.current?.currentTime ?? 0) + 0.5);
                        showOsd("+0.5s", "right");
                    }
                    break;
                case "[":
                    event.preventDefault();
                    setPlaybackRate((prev) => {
                        const next = Math.max(0.25, +(prev - 0.25).toFixed(2));
                        showOsd(`Speed ${next}x`, "center");
                        return next;
                    });
                    break;
                case "]":
                    event.preventDefault();
                    setPlaybackRate((prev) => {
                        const next = Math.min(4, +(prev + 0.25).toFixed(2));
                        showOsd(`Speed ${next}x`, "center");
                        return next;
                    });
                    break;
                case "ArrowUp":
                case "ArrowDown": {
                    event.preventDefault();
                    const el = videoRef.current;
                    if (!el) return;
                    const delta = event.key === "ArrowUp" ? 0.1 : -0.1;
                    const next = Math.min(Math.max(el.volume + delta, 0), 1);
                    el.volume = next;
                    el.muted = next === 0;
                    showOsd(`Volume ${Math.round(next * 100)}%`, "center");
                    break;
                }
                case "m":
                case "M":
                    event.preventDefault();
                    toggleMute();
                    showOsd(videoRef.current?.muted ? "Muted" : "Unmuted", "center");
                    break;
                case "n":
                case "N":
                    if (event.shiftKey && onNextRef.current) {
                        event.preventDefault();
                        cancelAutoNext();
                        onNextRef.current();
                    }
                    break;
                case "r":
                case "R":
                    event.preventDefault();
                    setLoop((prev) => {
                        const next = !prev;
                        showOsd(next ? "Loop On" : "Loop Off");
                        return next;
                    });
                    break;
                case "p":
                case "P":
                    if (event.shiftKey) {
                        // Shift+P: previous episode
                        if (onPrev) {
                            event.preventDefault();
                            onPrev();
                        }
                    } else if (document.pictureInPictureEnabled) {
                        event.preventDefault();
                        if (document.pictureInPictureElement) {
                            document.exitPictureInPicture();
                            showOsd("Exit Picture in Picture");
                        } else {
                            videoRef.current?.requestPictureInPicture().catch(() => {});
                            showOsd("Picture in Picture");
                        }
                    }
                    break;
                case "Home":
                    event.preventDefault();
                    seekTo(0);
                    showOsd("Start");
                    break;
                case "End": {
                    const dur = videoRef.current?.duration;
                    if (dur && dur > 0) {
                        event.preventDefault();
                        seekTo(Math.max(0, dur - 5));
                        showOsd("End");
                    }
                    break;
                }
                // ? is handled by a separate capture-phase listener
                case "f":
                case "F":
                    event.preventDefault();
                    showOsd(isFullscreen || fakeFullscreen ? "Exit Fullscreen" : "Fullscreen");
                    toggleFullscreen();
                    break;
                case "c":
                case "C":
                    if (!subtitles?.length) return;
                    event.preventDefault();
                    setActiveSubtitleIndex((prev) => {
                        if (subtitles.length === 0) return -1;
                        if (prev === -1) {
                            showOsd(`Subtitles: ${subtitles[0].name || "Track 1"}`);
                            return 0;
                        }
                        const next = prev + 1;
                        if (next < subtitles.length) {
                            showOsd(`Subtitles: ${subtitles[next].name || `Track ${next + 1}`}`);
                            return next;
                        }
                        showOsd("Subtitles Off");
                        return -1;
                    });
                    break;
                case "g":
                case "G":
                    event.preventDefault();
                    setSubtitleDelay((prev) => {
                        const next = prev - 500;
                        showOsd(`Sub Delay ${next >= 0 ? "+" : ""}${next}ms`);
                        return next;
                    });
                    break;
                case "h":
                case "H":
                    event.preventDefault();
                    setSubtitleDelay((prev) => {
                        const next = prev + 500;
                        showOsd(`Sub Delay ${next >= 0 ? "+" : ""}${next}ms`);
                        return next;
                    });
                    break;
            }
            // 0–9: seek to 0%–90% of duration (YouTube-style)
            if (/^[0-9]$/.test(event.key)) {
                const dur = videoRef.current?.duration;
                if (dur && dur > 0) {
                    event.preventDefault();
                    const pct = parseInt(event.key) / 10;
                    seekTo(pct * dur);
                    showOsd(`${parseInt(event.key) * 10}%`, "center");
                }
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [subtitles, togglePlay, toggleMute, toggleFullscreen, seekTo, showOsd, triggerSeekRipple, fakeFullscreen, isFullscreen, autoNextCountdown, cancelAutoNext, onPrev, resetControlsTimeout]);

    // Remote subtitle switching via device sync custom event
    useEffect(() => {
        const subHandler = (e: Event) => {
            const trackId = (e as CustomEvent).detail?.trackId as number | undefined;
            if (trackId !== undefined) {
                userSetSubtitleRef.current = true;
                setActiveSubtitleIndex(trackId);
            }
        };
        const fsHandler = () => {
            void toggleFullscreen();
        };
        window.addEventListener("device-sync-subtitle", subHandler);
        window.addEventListener("device-sync-fullscreen", fsHandler);
        return () => {
            window.removeEventListener("device-sync-subtitle", subHandler);
            window.removeEventListener("device-sync-fullscreen", fsHandler);
        };
    }, [toggleFullscreen]);

    // Persist player preferences to settings store so they survive reload
    useEffect(() => {
        useSettingsStore.getState().set("playback", {
            ...useSettingsStore.getState().settings.playback,
            subtitleSize,
            subtitlePosition,
            playbackSpeed: playbackRate,
            subtitleBackground,
            subtitleColor,
            subtitleFont,
        });
    }, [subtitleSize, subtitlePosition, playbackRate, subtitleBackground, subtitleColor, subtitleFont]);
    // Apply loop flag to the video element
    useEffect(() => {
        if (videoRef.current) videoRef.current.loop = loop;
    }, [loop]);

    // This allows the proxy to convert SRT->VTT before the browser starts video playback, similar to Stremio web.
    useEffect(() => {
        const first = subtitles?.[0];
        if (!first?.url) {
            setCanStartPlayback(true);
            return;
        }

        // Once playback has started, don't re-block it for subtitle changes.
        // The parsedCues effect handles loading new tracks independently.
        if (canStartPlayback) return;

        let done = false;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        setCanStartPlayback(false);

        const run = async () => {
            try {
                const res = await fetch(getProxyUrl(first.url), { signal: controller.signal });
                if (res.ok) {
                    // drain a small bit so the request fully completes in some environments
                    await res.text();
                }
            } catch {
                // If subtitle prep fails, don't block video playback.
            } finally {
                clearTimeout(timeoutId);
                if (!done) setCanStartPlayback(true);
            }
        };

        void run();
        return () => {
            done = true;
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [subtitles, canStartPlayback]);

    // Load addon subtitles and parse cues for manual overlay rendering.
    useEffect(() => {
        const el = videoRef.current;
        if (!el || !subtitles?.length) {
            setParsedCues([]);
            return;
        }
        if (!canStartPlayback) return;

        const controller = new AbortController();

        const parseTime = (t: string): number | null => {
            const s = t.trim().replace(",", ".");
            const parts = s.split(":");
            if (parts.length !== 2 && parts.length !== 3) return null;

            const [left, mid, rightRaw] = parts.length === 3 ? parts : ["0", parts[0], parts[1]];
            const [rightSecRaw, msRaw = "0"] = rightRaw.split(".");

            const hh = Number(left);
            const mm = Number(mid);
            const ss = Number(rightSecRaw);
            const ms = Number(msRaw.padEnd(3, "0"));
            if (![hh, mm, ss, ms].every(Number.isFinite)) return null;
            return hh * 3600 + mm * 60 + ss + ms / 1000;
        };

        const fetchSubtitleText = async (url: string): Promise<string | null> => {
            const perRequestController = new AbortController();
            const timeoutId = setTimeout(() => perRequestController.abort(), 8000);
            const onAbort = () => perRequestController.abort();
            controller.signal.addEventListener("abort", onAbort, { once: true });

            try {
                const res = await fetch(getProxyUrl(url), { signal: perRequestController.signal });
                if (!res.ok) return null;
                // Read as raw bytes and detect encoding ourselves.
                // The CORS proxy may not forward charset correctly, causing
                // UTF-8 bytes to be decoded as Latin-1 (e.g. "…" → "â€¦").
                const buf = await res.arrayBuffer();
                try {
                    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
                } catch {
                    return new TextDecoder("windows-1252").decode(buf);
                }
            } catch {
                return null;
            } finally {
                clearTimeout(timeoutId);
                controller.signal.removeEventListener("abort", onAbort);
            }
        };

        const parseCuesFromText = (text: string): SubtitleCue[] => {
            const cues: SubtitleCue[] = [];
            const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
            // Strip UTF-8 BOM if present
            const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
            const body = clean.startsWith("WEBVTT") ? clean.replace(/^WEBVTT[^\n]*\n+/, "") : clean;
            // Strip NOTE blocks (VTT comments)
            const withoutNotes = body.replace(/^NOTE\b[^\n]*\n(?:(?!\n\n)[\s\S])*?\n{2,}/gm, "");
            const blocks = withoutNotes.split(/\n{2,}/);

            for (const block of blocks) {
                const lines = block.split("\n").filter(Boolean);
                if (lines.length < 2) continue;

                // Skip STYLE blocks
                if (lines[0]!.startsWith("STYLE")) continue;

                const timeLineIdx = /^\d+$/.test(lines[0]!) ? 1 : 0;
                const timeLine = lines[timeLineIdx];
                if (!timeLine?.includes("-->")) continue;

                const [startRaw, endRaw] = timeLine.split("-->").map((p) => p.trim());
                const start = parseTime(startRaw);
                const end = parseTime(endRaw.split(/\s+/)[0] ?? "");
                if (start == null || end == null) continue;

                let cueText = lines.slice(timeLineIdx + 1).join("\n")
                    // Strip SSA/ASS style tags: {\an8}, {\i1}, {\pos(x,y)}, etc.
                    .replace(/\{\\[^}]+\}/g, "")
                    // Strip SSA/ASS override blocks: {text} (only if it looks like a tag)
                    .replace(/\{[^}]*\\[^}]+\}/g, "")
                    // Strip HTML formatting tags: <i>, </i>, <b>, <font ...>, etc.
                    .replace(/<\/?[^>]+(>|$)/g, "")
                    .trim();

                // Decode HTML entities (common in OpenSubtitles and community subs)
                if (cueText.includes("&")) {
                    cueText = cueText
                        .replace(/&amp;/gi, "&")
                        .replace(/&lt;/gi, "<")
                        .replace(/&gt;/gi, ">")
                        .replace(/&quot;/gi, '"')
                        .replace(/&apos;/gi, "'")
                        .replace(/&nbsp;/gi, " ")
                        .replace(/&lrm;/gi, "\u200E")
                        .replace(/&rlm;/gi, "\u200F")
                        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
                        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
                }

                if (cueText) cues.push({ start, end, text: cueText });
            }
            return cues;
        };

        const run = async () => {
            // Disable all existing subtitle/caption tracks (including embedded).
            const existing = Array.from(el.textTracks ?? []).filter(
                (t) => t.kind === "subtitles" || t.kind === "captions"
            );
            for (const t of existing) t.mode = "disabled";

            setParsedCues(subtitles.map(() => []));
            const allCues: SubtitleCue[][] = [];
            for (const sub of subtitles) {
                if (!sub.url) {
                    allCues.push([]);
                    continue;
                }

                const txt = await fetchSubtitleText(sub.url);
                if (!txt) {
                    allCues.push([]);
                    continue;
                }
                allCues.push(parseCuesFromText(txt));
            }
            setParsedCues(allCues);
        };

        void run();
        return () => controller.abort();
    }, [canStartPlayback, subtitles]);

    // Sync active cue text for manual overlay (bypasses Windows OS ::cue style override)
    useEffect(() => {
        if (activeSubtitleIndex < 0) {
            setActiveCueText("");
            return;
        }
        const cues = parsedCues[activeSubtitleIndex];
        if (!cues?.length) {
            setActiveCueText("");
            return;
        }
        // Find the cue that matches currentTime, adjusted by subtitle delay
        const adjustedTime = currentTime - subtitleDelay / 1000;
        const activeCue = cues.find((c) => adjustedTime >= c.start && adjustedTime < c.end);
        setActiveCueText(activeCue?.text ?? "");
    }, [activeSubtitleIndex, parsedCues, currentTime, subtitleDelay]);

    // iOS: ensure playsinline (and webkit prefix for older Safari)
    useEffect(() => {
        const el = videoRef.current;
        if (el) el.setAttribute("webkit-playsinline", "true");
    }, []);

    // Use always-visible compact controls on touch/coarse pointers and narrow layouts.
    useEffect(() => {
        const updateCompactMode = () => {
            const narrow = window.matchMedia("(max-width: 960px)").matches;
            const coarse = window.matchMedia("(pointer: coarse)").matches;
            setUseCompactControls(narrow || coarse);
        };

        updateCompactMode();
        window.addEventListener("resize", updateCompactMode);
        return () => window.removeEventListener("resize", updateCompactMode);
    }, []);

    return (
        <div
            ref={containerRef}
            className={cn(
                "relative w-full h-full flex flex-col bg-black debridui-legacy-player group",
                `debridui-sub-bg-${subtitleBackground}`,
                fakeFullscreen && "fixed inset-0 z-[9999]",
                !showControls && isPlaying && "player-hide-cursor"
            )}
            onClick={handleContainerClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}>
            <LegacyPlayerSubtitleStyle />
            {error ? (
                <div className="flex-1 flex flex-col items-center justify-center text-white">
                    <AlertCircle className="h-12 w-12 mb-2" />
                    <p className="text-sm">Failed to load video</p>
                    <p className="text-xs text-white/70 mt-1">{file.name}</p>
                    {streamingLinks && Object.keys(streamingLinks).length > 0 && (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="mt-3"
                            onClick={() => {
                                setError(false);
                                setIsLoading(true);
                                setTriedTranscodeFallback(true);
                                const transcodedUrl = streamingLinks.liveMP4 || streamingLinks.apple || streamingLinks.h264WebM;
                                if (transcodedUrl && videoRef.current) {
                                    videoRef.current.src = transcodedUrl;
                                    videoRef.current.load();
                                    videoRef.current.play().catch(() => {});
                                }
                            }}
                        >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Try Transcoded Format
                        </Button>
                    )}
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0 relative">
                    <video
                        ref={videoRef}
                        src={canStartPlayback ? finalUrl : undefined}
                        autoPlay={canStartPlayback && !iosTapToPlay}
                        playsInline
                        preload="metadata"
                        crossOrigin={isHls || isUsingTranscodedStream ? "anonymous" : undefined}
                        className="w-full h-full object-contain bg-black"
                        style={{ maxHeight: "100%" }}
                        onLoadedMetadata={handleLoadedMetadata}
                        onLoadedData={handleLoad}
                        onError={handleError}
                    />

                    {/* YouTube-style top loading bar */}
                    {(!canStartPlayback || (isLoading && !error)) && (
                        <div className="player-loading-bar absolute top-0 left-0 right-0 h-[3px] z-50 overflow-hidden" />
                    )}

                    {/* Unified loading overlay */}
                    {(!canStartPlayback || (isLoading && !error)) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-40">
                            <div className="h-10 w-10 border-[2.5px] border-white/15 border-t-white rounded-full animate-spin" />
                            {!canStartPlayback && (
                                <p className="text-xs tracking-widest uppercase text-white/40">Preparing subtitles</p>
                            )}
                        </div>
                    )}

                    {/* YouTube-style center action icon (flash on play/pause) */}
                    <div className="player-center-action">
                        <div
                            className="player-center-action-icon"
                            data-visible={centerAction !== null ? "true" : "false"}
                        >
                            {centerAction === "play" ? (
                                <Play className="h-6 w-6 fill-current ml-0.5" />
                            ) : (
                                <Pause className="h-6 w-6 fill-current" />
                            )}
                        </div>
                    </div>

                    {/* Big center play button when paused (idle state) */}
                    {!isLoading && !isPlaying && !centerAction && (
                        <div className="player-center-action">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlay();
                                }}
                                className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-white border border-white/10 transition-all duration-150 hover:scale-110 hover:bg-black/60 active:scale-95"
                            >
                                <Play className="h-7 w-7 fill-current ml-0.5" />
                            </button>
                        </div>
                    )}

                    {/* Mobile center controls: skip ±10s + play/pause */}
                    {useCompactControls && showControls && !isLoading && (
                        <div className="absolute inset-0 z-30 flex items-center justify-center gap-10 pointer-events-none" data-player-controls>
                            <button
                                onClick={(e) => { e.stopPropagation(); seekTo((videoRef.current?.currentTime ?? 0) - 10); }}
                                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 active:scale-90 transition-transform"
                            >
                                <SkipBack className="size-5" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white active:scale-90 transition-transform"
                            >
                                {isPlaying ? <Pause className="size-6" /> : <Play className="size-6 fill-current ml-0.5" />}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); seekTo((videoRef.current?.currentTime ?? 0) + 10); }}
                                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 active:scale-90 transition-transform"
                            >
                                <SkipForward className="size-5" />
                            </button>
                        </div>
                    )}

                    {/* Seek ripple animation (double-tap) */}
                    {seekRipple && (
                        <div
                            key={seekRipple.key}
                            className="player-seek-ripple"
                            data-dir={seekRipple.dir}
                        />
                    )}

                    {/* In-player OSD for keyboard shortcut feedback */}
                    <div
                        className={cn(
                            "player-osd absolute z-40 pointer-events-none transition-all",
                            osdPosition === "top-right" && "top-14 right-6",
                            osdPosition === "center" && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                            osdPosition === "left" && "top-1/2 left-12 -translate-y-1/2",
                            osdPosition === "right" && "top-1/2 right-12 -translate-y-1/2",
                            osdVisible
                                ? "opacity-100 scale-100"
                                : "opacity-0 scale-95"
                        )}
                        style={{ transitionDuration: osdVisible ? "150ms" : "250ms", transitionTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1)" }}
                    >
                        <div className="player-osd-inner rounded-lg px-5 py-2.5 text-sm font-semibold text-white min-w-[100px] text-center"
                            style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)", letterSpacing: "0.03em" }}>
                            {osdText}
                            {/^Volume \d+%$/.test(osdText) && (
                                <div className="player-osd-bar mt-2 h-1 w-full rounded-full bg-white/15 overflow-hidden">
                                    <div
                                        className="player-osd-bar-fill h-full rounded-full"
                                        style={{ width: `${osdText.match(/(\d+)/)?.[1] ?? 0}%`, transition: "width 100ms ease", background: "var(--primary)" }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Keyboard shortcuts help overlay (?key) */}
                    {showHelp && (
                        <div
                            className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
                            onClick={() => setShowHelp(false)}>
                            <div
                                className="rounded-sm border border-white/10 bg-black/90 p-6 mx-4 max-w-lg w-full"
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-[10px] tracking-widest uppercase text-white/40">Keyboard Shortcuts</span>
                                    <button onClick={() => setShowHelp(false)} className="text-white/30 hover:text-white text-xs transition-colors">×</button>
                                </div>
                                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                                    {([
                                        ["Space / K", "Play / Pause"],
                                        ["\u2190 \u2192", "Seek \u00b15s"],
                                        ["J / L", "Seek \u00b110s"],
                                        ["\u2191 \u2193", "Volume \u00b110%"],
                                        ["M", "Mute / Unmute"],
                                        ["F", "Fullscreen"],
                                        ["R", "Loop Toggle"],
                                        ["P", "Picture in Picture"],
                                        ["Shift+P", "Previous Episode"],
                                        ["C", "Cycle Subtitles"],
                                        ["G / H", "Sub Delay \u2212/+500ms"],
                                        ["[ / ]", "Speed \u22120.25x / +0.25x"],
                                        ["0 \u2013 9", "Seek to 0% \u2013 90%"],
                                        ["Home", "Jump to Start"],
                                        ["End", "Jump to Near-End"],
                                        ["Shift+N", "Next Episode"],
                                        [", / .", "Frame Step \u00b10.5s (paused)"],
                                        ["?", "Show / Hide Help"],
                                    ] as [string, string][]).map(([key, desc]) => (
                                        <div key={key} className="flex items-center gap-3">
                                            <kbd className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/80">{key}</kbd>
                                            <span className="text-xs text-white/50">{desc}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <VideoCodecWarning
                        show={shouldShowWarning && showCodecWarning}
                        isPlaying={isPlaying}
                        onClose={() => setShowCodecWarning(false)}
                        onOpenInPlayer={openInExternalPlayer}
                    />

                    {/* Mobile swipe seek preview bar */}
                    {swipeSeekPreview && duration > 0 && (
                        <div className="absolute inset-x-4 top-1/2 z-40 pointer-events-none -translate-y-1/2">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-semibold text-white tabular-nums drop-shadow">{formatTime(swipeSeekPreview.targetTime)}</span>
                                <div className="flex-1 h-1 rounded-full bg-white/20 overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-75" style={{ width: `${(swipeSeekPreview.targetTime / duration) * 100}%`, background: "var(--primary)" }} />
                                </div>
                                <span className="text-xs text-white/50 tabular-nums drop-shadow">{formatTime(duration)}</span>
                            </div>
                        </div>
                    )}

                    {/* Manual subtitle overlay */}
                    {activeCueText && (
                        <div
                            className="debridui-subtitle-overlay pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4"
                            style={{ bottom: `${(showControls ? subtitlePosition + 60 : subtitlePosition)}px`, transition: 'bottom 200ms ease' }}
                            aria-live="polite">
                            <span
                                className="debridui-subtitle-text inline-block max-w-[90%] text-center px-3 py-1.5 rounded-sm"
                                style={{
                                    fontSize: `${subtitleSize}px`,
                                    color: subtitleColor,
                                    fontFamily: subtitleFont === 'mono' ? 'ui-monospace, monospace'
                                        : subtitleFont === 'serif' ? 'ui-serif, Georgia, serif'
                                        : subtitleFont === 'trebuchet' ? '"Trebuchet MS", sans-serif'
                                        : undefined,
                                }}
                            >
                                {activeCueText.split("\n").map((line, i) => (
                                    <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
                                ))}
                            </span>
                        </div>
                    )}

                    {/* Top title bar */}
                    <div
                        className={cn(
                            "absolute inset-x-0 top-0 z-40 pointer-events-none transition-all duration-300 ease-out",
                            showControls ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
                        )}
                    >
                        <div
                            data-player-controls
                            className="pointer-events-auto px-4 pb-10 pt-3"
                            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)" }}
                        >
                            <p className="truncate text-sm font-medium text-white drop-shadow-md">{file.name}</p>
                        </div>
                    </div>

                    {/* Floating CTA stack: keep skip/next prompts in one place to avoid overlap */}
                    {(autoNextCountdown !== null || (activeSkipSegment && !autoSkipIntro)) && (
                        <div
                            data-player-controls
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            className="player-cta-stack absolute bottom-20 right-4 z-[45] flex flex-col items-end gap-2"
                        >
                            {autoNextCountdown !== null && onNext && (
                                <div className="flex flex-col items-end gap-2">
                                    <div
                                        className="rounded-lg border border-white/15 overflow-hidden"
                                        style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(16px)", maxWidth: 320 }}
                                    >
                                        <div className="px-4 pt-3 pb-1">
                                            <p className="text-[11px] uppercase tracking-wider text-white/40 font-medium">Up Next</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { cancelAutoNext(); guardedNav(onNext); }}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all hover:bg-white/5 active:scale-[0.98]"
                                        >
                                            <svg width="28" height="28" viewBox="0 0 40 40" className="shrink-0 -rotate-90">
                                                <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
                                                <circle
                                                    cx="20" cy="20" r="18" fill="none" stroke="var(--primary)" strokeWidth="2.5"
                                                    strokeDasharray="113" className="player-countdown-ring"
                                                    style={{ "--countdown-duration": `${autoNextCountdown}s` } as React.CSSProperties}
                                                />
                                            </svg>
                                            <div className="flex-1 text-left min-w-0">
                                                <p className="text-sm font-medium text-white truncate">Next Episode</p>
                                            </div>
                                            <SkipForward className="size-4 text-white/60 shrink-0" />
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={cancelAutoNext}
                                        className="rounded px-3 py-1 text-xs text-white/50 transition-colors hover:text-white/90"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}

                            {activeSkipSegment && !autoSkipIntro && (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const seg = introSegments?.[activeSkipSegment];
                                            if (seg && videoRef.current) {
                                                skippedSegmentsRef.current.add(activeSkipSegment);
                                                videoRef.current.currentTime = seg.end_sec;
                                                setActiveSkipSegment(null);
                                            }
                                        }}
                                        className="player-cta-btn inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-md border border-white/20 cursor-pointer transition-all hover:bg-primary hover:border-primary hover:text-primary-foreground active:scale-[0.96]"
                                        style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
                                    >
                                        <SkipForward className="size-4" />
                                        {activeSkipSegment === "intro" ? "Skip Intro" : activeSkipSegment === "recap" ? "Skip Recap" : "Skip Credits"}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Dismiss"
                                        onClick={() => {
                                            skippedSegmentsRef.current.add(activeSkipSegment);
                                            setActiveSkipSegment(null);
                                        }}
                                        className="flex items-center justify-center rounded-md bg-black/60 backdrop-blur-sm p-2 text-white/50 transition-all hover:bg-white/10 hover:text-white active:scale-90"
                                    >
                                        <X className="size-3" />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Custom control bar */}
                    <div
                        className={cn(
                            "absolute inset-x-0 bottom-0 z-40 pointer-events-none transition-all duration-300 ease-out",
                            showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                        )}
                    >
                        <div
                            data-player-controls
                            className="pointer-events-auto px-4 pt-16 pb-3"
                            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.15) 80%, transparent 100%)" }}
                        >
                            {/* Custom seekbar */}
                            <div
                                ref={seekbarRef}
                                className="player-seekbar relative w-full cursor-pointer flex items-center touch-none"
                                role="slider"
                                aria-label="Seek"
                                aria-valuenow={Math.round(currentTime)}
                                aria-valuemin={0}
                                aria-valuemax={Math.round(duration)}
                                tabIndex={0}
                                data-dragging={isDraggingSeekbar ? "true" : "false"}
                                onPointerDown={handleSeekbarPointerDown}
                                onPointerMove={handleSeekbarPointerMove}
                                onPointerUp={handleSeekbarPointerUp}
                                onPointerLeave={handleSeekbarPointerLeave}
                            >
                                {/* Track background + buffered + progress */}
                                <div className="player-seekbar-track">
                                    <div
                                        className="player-seekbar-buffered absolute inset-y-0 left-0 bg-white/30 rounded-[inherit]"
                                        style={{ width: `${bufferedPercent}%` }}
                                    />
                                    <div
                                        className="player-seekbar-progress absolute inset-y-0 left-0 rounded-[inherit]"
                                        style={{
                                            width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                                            background: "var(--primary)"
                                        }}
                                    />
                                    {/* IntroDB segment markers */}
                                    {introSegments && duration > 0 && (
                                        <>
                                            {(['intro', 'recap', 'outro'] as const).map((type) => {
                                                const seg = introSegments[type];
                                                if (!seg) return null;
                                                const left = (seg.start_sec / duration) * 100;
                                                const width = ((seg.end_sec - seg.start_sec) / duration) * 100;
                                                const opacity = type === 'intro' ? 0.8 : type === 'recap' ? 0.5 : 0.3;
                                                return (
                                                    <div
                                                        key={type}
                                                        title={type === 'intro' ? 'Intro' : type === 'recap' ? 'Recap' : 'Credits'}
                                                        className="player-seekbar-marker"
                                                        style={{
                                                            left: `${left}%`,
                                                            width: `${width}%`,
                                                            background: `color-mix(in oklch, var(--primary) ${opacity * 100}%, transparent)`,
                                                        }}
                                                    />
                                                );
                                            })}
                                        </>
                                    )}
                                </div>
                                {/* Thumb */}
                                <div
                                    className="player-seekbar-thumb"
                                    style={{
                                        left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`
                                    }}
                                />
                                {/* Hover tooltip */}
                                {seekHoverPct !== null && duration > 0 && (
                                    <div
                                        className="player-seekbar-tooltip"
                                        style={{
                                            left: `clamp(24px, ${seekHoverPct * 100}%, calc(100% - 24px))`
                                        }}
                                    >
                                        {formatTime(seekHoverPct * duration)}
                                    </div>
                                )}
                            </div>

                            {/* Controls row */}
                            <div className="mt-2 flex items-center gap-1 text-white">
                                {/* Left: Play, Prev/Next, Time */}
                                <div className="flex items-center gap-0.5">
                                    <button
                                        className={PLAYER_BTN_MD}
                                        onClick={togglePlay}
                                        disabled={isLoading}
                                        aria-label={isPlaying ? "Pause" : "Play"}
                                    >
                                        {isPlaying ? (
                                            <Pause className="h-5 w-5 fill-current" />
                                        ) : (
                                            <Play className="h-5 w-5 fill-current ml-0.5" />
                                        )}
                                    </button>

                                    <button
                                        className={PLAYER_BTN_SM}
                                        onClick={(e) => { e.stopPropagation(); guardedNav(onPrev); }}
                                        disabled={!onPrev}
                                        title="Previous episode"
                                    >
                                        <SkipBack className="h-4 w-4 fill-current" />
                                    </button>
                                    <button
                                        className={PLAYER_BTN_SM}
                                        onClick={(e) => { e.stopPropagation(); guardedNav(onNext); }}
                                        disabled={!onNext}
                                        title="Next episode"
                                    >
                                        <SkipForward className="h-4 w-4 fill-current" />
                                    </button>

                                    {/* Volume */}
                                    <div
                                        className="flex items-center group/volume ml-1"
                                        onWheel={(e) => {
                                            e.stopPropagation();
                                            const el = videoRef.current;
                                            if (!el) return;
                                            const delta = e.deltaY < 0 ? 0.05 : -0.05;
                                            const next = Math.min(Math.max(el.volume + delta, 0), 1);
                                            el.volume = next;
                                            el.muted = next === 0;
                                            showOsd(next === 0 ? "Muted" : `Volume ${Math.round(next * 100)}%`, "center");
                                        }}
                                    >
                                        <button
                                            className={PLAYER_BTN_SM}
                                            onClick={toggleMute}
                                            aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
                                        >
                                            {isMuted || volume === 0 ? (
                                                <VolumeX className="h-5 w-5" />
                                            ) : (
                                                <Volume2 className="h-5 w-5" />
                                            )}
                                        </button>
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={isMuted ? 0 : volume}
                                            onChange={handleVolumeChange}
                                            style={{
                                                background: `linear-gradient(to right, var(--primary) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.25) ${(isMuted ? 0 : volume) * 100}%)`
                                            }}
                                            className={cn(
                                                "h-1 cursor-pointer appearance-none rounded-full accent-primary player-volume-slider",
                                                useCompactControls ? "w-16 ml-1 opacity-100" : "w-0 ml-0 opacity-0 group-hover/volume:w-20 group-hover/volume:ml-1 group-hover/volume:opacity-100"
                                            )}
                                        />
                                    </div>

                                    <span
                                        className="text-[13px] font-medium tabular-nums ml-3 select-none cursor-pointer hover:text-white/80 transition-colors"
                                        onClick={() => setShowRemainingTime((v) => !v)}
                                        title="Click to toggle remaining time"
                                    >
                                        {formatTime(currentTime)}
                                        <span className="text-white/35 mx-1">/</span>
                                        <span className="text-white/55">
                                            {showRemainingTime
                                                ? `-${formatTime(Math.max(0, duration - currentTime))}`
                                                : formatTime(duration)
                                            }
                                        </span>
                                    </span>
                                    {playbackRate !== 1 && (
                                        <span className="ml-2 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white/80 select-none">
                                            {playbackRate}×
                                        </span>
                                    )}
                                </div>

                                {/* Right: Audio, CC, Settings, Cast, Fullscreen */}
                                <div className="ml-auto flex items-center gap-1">
                                    {/* Audio track selector */}
                                    {audioTrackCount > 1 && (
                                        <DropdownMenu
                                            open={openMenu === "audio"}
                                            onOpenChange={(open) => setOpenMenuTracked(open ? "audio" : null)}
                                        >
                                            <DropdownMenuTrigger asChild>
                                                <button className={cn(PLAYER_BTN_SM, "text-[11px] font-medium tracking-wide")}>
                                                    Audio
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[200px] max-h-[280px] overflow-y-auto z-50 p-1")}
                                                    style={POPUP_STYLE}
                                                >
                                                    <div className={POPUP_LABEL}>Audio Tracks</div>
                                                    {Array.from({ length: audioTrackCount }, (_, i) => {
                                                        const el = videoRef.current as (HTMLVideoElement & {
                                                            audioTracks?: {
                                                                length: number;
                                                                [i: number]: {
                                                                    enabled: boolean;
                                                                    label?: string;
                                                                    language?: string;
                                                                };
                                                            };
                                                        }) | null;
                                                        const t = el?.audioTracks?.[i];
                                                        const langLabel = t?.language
                                                            ? getLanguageDisplayName(t.language)
                                                            : "";
                                                        const base = (t?.label ?? "").trim();
                                                        const label =
                                                            [langLabel, base].filter(Boolean).join(" · ") ||
                                                            `Track ${i + 1}`;
                                                        return (
                                                            <button
                                                                key={i}
                                                                onClick={() => { setSelectedAudioIndex(i); showOsd(`Audio: ${label}`); setOpenMenuTracked(null); }}
                                                                className={POPUP_ITEM}
                                                                data-active={selectedAudioIndex === i}
                                                            >
                                                                {label}
                                                            </button>
                                                        );
                                                    })}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {/* Subtitles menu */}
                                    {subtitles && subtitles.length > 0 && (
                                        <DropdownMenu
                                            open={openMenu === "subtitles"}
                                            onOpenChange={(open) => setOpenMenuTracked(open ? "subtitles" : null)}
                                        >
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    className={cn(
                                                        PLAYER_BTN_SM, "text-[11px] font-medium tracking-wide",
                                                        activeSubtitleIndex >= 0 && "text-primary"
                                                    )}
                                                >
                                                    CC
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[180px] max-h-[300px] overflow-y-auto z-50 p-1")}
                                                    style={POPUP_STYLE}
                                                >
                                                    <div className={POPUP_LABEL}>Subtitles</div>
                                                    <button
                                                        onClick={() => { userSetSubtitleRef.current = true; setActiveSubtitleIndex(-1); setOpenMenuTracked(null); }}
                                                        className={POPUP_ITEM}
                                                        data-active={activeSubtitleIndex === -1}
                                                    >
                                                        Off
                                                    </button>
                                                    {subtitles.map((sub, i) => (
                                                        <button
                                                            key={`${sub.lang}-${sub.url}-${i}`}
                                                            onClick={() => { userSetSubtitleRef.current = true; setActiveSubtitleIndex(i); setOpenMenuTracked(null); }}
                                                            className={POPUP_ITEM}
                                                            data-active={activeSubtitleIndex === i}
                                                        >
                                                            {sub.name ?? getLanguageDisplayName(sub.lang)}
                                                        </button>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {/* Settings menu */}
                                    <DropdownMenu
                                        open={openMenu === "settings"}
                                        onOpenChange={(open) => { setOpenMenuTracked(open ? "settings" : null); if (!open) setSettingsPanel(null); }}
                                    >
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                className={PLAYER_BTN_SM}
                                                style={{ transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
                                            >
                                                <Settings className={cn("h-5 w-5 transition-transform duration-[400ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]", openMenu === "settings" && "rotate-90")} />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                            <DropdownMenuContent
                                                data-player-controls
                                                align="end"
                                                side="top"
                                                sideOffset={4}
                                                onClick={(e) => e.stopPropagation()}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                                className={cn(POPUP_CLS, "w-[250px] max-h-[350px] overflow-y-auto z-50")}
                                                style={POPUP_STYLE}
                                            >
                                                {/* === Main settings panel === */}
                                                {settingsPanel === null && (
                                                    <div className="py-1">
                                                        {/* Speed row */}
                                                        <button
                                                            onClick={() => setSettingsPanel("speed")}
                                                            className={POPUP_ITEM}
                                                        >
                                                            <span className="flex-1">Playback speed</span>
                                                            <span className="text-[11px] text-white/40 tabular-nums">{playbackRate === 1 ? "Normal" : `${playbackRate}x`}</span>
                                                            <ChevronRight className="size-3.5 text-white/30" />
                                                        </button>
                                                        {/* Subtitles row */}
                                                        {subtitles && subtitles.length > 0 && (
                                                            <button
                                                                onClick={() => setSettingsPanel("subtitles")}
                                                                className={POPUP_ITEM}
                                                            >
                                                                <span className="flex-1">Subtitles</span>
                                                                <span className="text-[11px] text-white/40 truncate max-w-[80px]">{subtitleSize}px</span>
                                                                <ChevronRight className="size-3.5 text-white/30" />
                                                            </button>
                                                        )}
                                                        {/* Open in player */}
                                                        {Object.values(MediaPlayer).filter((p) => p !== MediaPlayer.BROWSER && isSupportedPlayer(p)).length > 0 && (
                                                            <button
                                                                onClick={() => setSettingsPanel("players")}
                                                                className={POPUP_ITEM}
                                                            >
                                                                <span className="flex-1">Open in player</span>
                                                                <ChevronRight className="size-3.5 text-white/30" />
                                                            </button>
                                                        )}
                                                        {/* PiP — direct action */}
                                                        {typeof document !== "undefined" && document.pictureInPictureEnabled && (
                                                            <button
                                                                onClick={() => {
                                                                    const video = videoRef.current;
                                                                    if (!video) return;
                                                                    if (document.pictureInPictureElement) {
                                                                        document.exitPictureInPicture();
                                                                        showOsd("Exit Picture in Picture");
                                                                    } else {
                                                                        video.requestPictureInPicture().catch(() => {});
                                                                        showOsd("Picture in Picture");
                                                                    }
                                                                    setOpenMenuTracked(null);
                                                                    setSettingsPanel(null);
                                                                }}
                                                                className={POPUP_ITEM}
                                                            >
                                                                <PictureInPicture2 className="size-3.5 opacity-60" /> Picture in Picture
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                {/* === Speed sub-panel === */}
                                                {settingsPanel === "speed" && (
                                                    <div
                                                        className="py-1"
                                                        onWheel={(e) => {
                                                            e.stopPropagation();
                                                            setPlaybackRate((prev) => {
                                                                const next = e.deltaY < 0
                                                                    ? Math.min(4, +(prev + 0.25).toFixed(2))
                                                                    : Math.max(0.25, +(prev - 0.25).toFixed(2));
                                                                showOsd(`Speed ${next}x`, "center");
                                                                return next;
                                                            });
                                                        }}
                                                    >
                                                        <button onClick={() => setSettingsPanel(null)} className={cn(POPUP_ITEM, "gap-1.5 text-white/50 hover:text-white")}>
                                                            <ArrowLeft className="size-3.5" /> <span className="text-[12px]">Back</span>
                                                        </button>
                                                        <div className={POPUP_DIVIDER} />
                                                        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                                                            <button
                                                                key={rate}
                                                                onClick={() => { setPlaybackRate(rate); showOsd(`Speed ${rate}x`, "center"); setSettingsPanel(null); }}
                                                                className={POPUP_ITEM}
                                                                data-active={playbackRate === rate}
                                                            >
                                                                {rate === 1 ? "Normal" : `${rate}x`}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* === Subtitles sub-panel === */}
                                                {settingsPanel === "subtitles" && (
                                                    <div className="py-1">
                                                        <button onClick={() => setSettingsPanel(null)} className={cn(POPUP_ITEM, "gap-1.5 text-white/50 hover:text-white")}>
                                                            <ArrowLeft className="size-3.5" /> <span className="text-[12px]">Back</span>
                                                        </button>
                                                        <div className={POPUP_DIVIDER} />
                                                        {/* Size */}
                                                        <div className={POPUP_LABEL}>Size</div>
                                                        <div
                                                            className="player-stepper flex items-center justify-between px-3.5 pt-1 pb-2"
                                                            onWheel={(e) => { e.stopPropagation(); setSubtitleSize((s) => Math.max(12, Math.min(64, s + (e.deltaY < 0 ? 2 : -2)))); }}
                                                        >
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSubtitleSize((s) => Math.max(12, s - 2))}
                                                            >
                                                                <Minus className="h-3.5 w-3.5" />
                                                            </button>
                                                            <span className="player-stepper-value text-xs tabular-nums font-mono text-white/70">{subtitleSize}px</span>
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSubtitleSize((s) => Math.min(64, s + 2))}
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        {/* Position */}
                                                        <div className={POPUP_LABEL}>Position</div>
                                                        <div
                                                            className="player-stepper flex items-center justify-between px-3.5 pt-1 pb-2"
                                                            onWheel={(e) => { e.stopPropagation(); setSubtitlePosition((s) => Math.max(20, Math.min(400, s + (e.deltaY < 0 ? 4 : -4)))); }}
                                                        >
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSubtitlePosition((s) => Math.max(20, s - 4))}
                                                            >
                                                                <Minus className="h-3.5 w-3.5" />
                                                            </button>
                                                            <span className="player-stepper-value text-xs tabular-nums font-mono text-white/70">{subtitlePosition}px</span>
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSubtitlePosition((s) => Math.min(400, s + 4))}
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        {/* Delay */}
                                                        <div className={POPUP_LABEL}>Delay</div>
                                                        <div
                                                            className="player-stepper flex items-center justify-between px-3.5 pt-1 pb-2"
                                                            onWheel={(e) => { e.stopPropagation(); setSubtitleDelay((s) => s + (e.deltaY < 0 ? 500 : -500)); }}
                                                        >
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSubtitleDelay((s) => s - 500)}
                                                            >
                                                                <Minus className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button
                                                                className="player-stepper-value text-xs tabular-nums font-mono text-white/70 hover:text-primary transition-colors bg-transparent border-none cursor-pointer"
                                                                title="Click to reset"
                                                                onClick={() => setSubtitleDelay(0)}
                                                            >
                                                                {subtitleDelay > 0 ? "+" : ""}{subtitleDelay}ms
                                                            </button>
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSubtitleDelay((s) => s + 500)}
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        {/* Background style */}
                                                        <div className={POPUP_LABEL}>Background</div>
                                                        <div className="flex items-center gap-1.5 px-3.5 pt-1 pb-2">
                                                            {([
                                                                ["solid", "Solid"],
                                                                ["semi", "Semi"],
                                                                ["outline", "Outline"],
                                                                ["none", "None"],
                                                            ] as const).map(([id, label]) => (
                                                                <button
                                                                    key={id}
                                                                    onClick={() => setSubtitleBackground(id)}
                                                                    className={cn(
                                                                        "flex-1 text-[10px] py-1 rounded-sm border transition-colors cursor-pointer",
                                                                        subtitleBackground === id
                                                                            ? "border-primary/60 bg-primary/10 text-white"
                                                                            : "border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70"
                                                                    )}
                                                                >
                                                                    {label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        {/* Text color */}
                                                        <div className={POPUP_LABEL}>Color</div>
                                                        <div className="flex items-center gap-2 px-3.5 pt-1 pb-2">
                                                            {[
                                                                ["#ffffff", "White"],
                                                                ["#ffff00", "Yellow"],
                                                                ["#00ffff", "Cyan"],
                                                                ["#00ff00", "Green"],
                                                            ].map(([hex, label]) => (
                                                                <button
                                                                    key={hex}
                                                                    title={label}
                                                                    onClick={() => setSubtitleColor(hex)}
                                                                    className={cn(
                                                                        "size-6 rounded-full border-2 transition-all cursor-pointer",
                                                                        subtitleColor === hex
                                                                            ? "border-primary scale-110"
                                                                            : "border-white/20 hover:border-white/50"
                                                                    )}
                                                                    style={{ backgroundColor: hex }}
                                                                />
                                                            ))}
                                                        </div>
                                                        {/* Font family */}
                                                        <div className={POPUP_LABEL}>Font</div>
                                                        <div className="flex items-center gap-1.5 px-3.5 pt-1 pb-2">
                                                            {([
                                                                ["default", "Default"],
                                                                ["mono", "Mono"],
                                                                ["serif", "Serif"],
                                                                ["trebuchet", "Trebuchet"],
                                                            ] as const).map(([id, label]) => (
                                                                <button
                                                                    key={id}
                                                                    onClick={() => setSubtitleFont(id)}
                                                                    className={cn(
                                                                        "flex-1 text-[10px] py-1 rounded-sm border transition-colors cursor-pointer",
                                                                        subtitleFont === id
                                                                            ? "border-primary/60 bg-primary/10 text-white"
                                                                            : "border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70"
                                                                    )}
                                                                >
                                                                    {label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* === Players sub-panel === */}
                                                {settingsPanel === "players" && (
                                                    <div className="py-1">
                                                        <button onClick={() => setSettingsPanel(null)} className={cn(POPUP_ITEM, "gap-1.5 text-white/50 hover:text-white")}>
                                                            <ArrowLeft className="size-3.5" /> <span className="text-[12px]">Back</span>
                                                        </button>
                                                        <div className={POPUP_DIVIDER} />
                                                        {Object.values(MediaPlayer)
                                                            .filter((p) => p !== MediaPlayer.BROWSER && isSupportedPlayer(p))
                                                            .map((player) => (
                                                                <button
                                                                    key={player}
                                                                    onClick={() => { openInExternalPlayer(player); setOpenMenuTracked(null); setSettingsPanel(null); }}
                                                                    className={POPUP_ITEM}
                                                                >
                                                                    <ExternalLink className="size-3.5 opacity-60" /> {player}
                                                                </button>
                                                            ))}
                                                    </div>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenuPortal>
                                    </DropdownMenu>

                                    {/* Cast to device */}
                                    <PlayerCastButton
                                        videoRef={videoRef}
                                        downloadUrl={effectiveUrl}
                                        title={file.name}
                                        subtitles={subtitles}
                                    />

                                    {/* Fullscreen */}
                                    <button
                                        className={PLAYER_BTN_SM}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleFullscreen();
                                        }}
                                        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                                    >
                                        {isFullscreen ? (
                                            <Minimize2 className="h-5 w-5" />
                                        ) : (
                                            <Maximize2 className="h-5 w-5" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* iOS: tap-to-play overlay so playback runs in user gesture context */}
                    {ios && iosTapToPlay && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleIosTapToPlay(); }}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-white z-50">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 backdrop-blur-md">
                                <Play className="h-10 w-10 fill-current ml-1" />
                            </div>
                            <span className="text-sm font-medium">Tap to play</span>
                            {hasCodecIssue && !isUsingTranscodedStream && (
                                <span className="text-xs text-white/70 max-w-xs text-center px-4">
                                    This format may not play in Safari. If playback fails, use an external player app.
                                </span>
                            )}
                        </button>
                    )}



                    {/* If loading takes too long, stream may not support Range requests or codec is unsupported */}
                    {showLoadingHint && (
                        <div data-player-controls onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} className="absolute bottom-16 left-0 right-0 z-50 border-t border-white/10 bg-black/90 px-4 py-3 text-center text-xs text-white backdrop-blur-md sm:bottom-20 sm:left-4 sm:right-4 sm:rounded-sm sm:border">
                            <p className="mb-2 font-medium">Video taking too long?</p>
                            <p className="mb-3 text-white/70">
                                {hasCodecIssue 
                                    ? "This video format (MKV/AC3/DTS) may not be supported by your browser."
                                    : "The stream may not be compatible with your browser."}
                            </p>
                            <p className="mb-3 text-white/70">Try an external player app:</p>
                            <div className="flex flex-wrap justify-center gap-3">
                                {Object.values(MediaPlayer)
                                    .filter((p) => p !== MediaPlayer.BROWSER && isSupportedPlayer(p))
                                    .slice(0, 3)
                                    .map((player) => (
                                        <button
                                            key={player}
                                            type="button"
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary/20 hover:bg-primary/30 text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                            onClick={() => openInExternalPlayer(player)}>
                                            <ExternalLink className="h-3 w-3" />
                                            {player}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
