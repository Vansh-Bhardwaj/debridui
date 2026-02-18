"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, Settings, Plus, Minus, ExternalLink, AlertCircle, Loader2, SkipBack, SkipForward, RefreshCw, Cast, PictureInPicture2, X } from "lucide-react";
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
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-white hover:bg-white/20"
                    aria-label="Cast to device">
                    <Cast className={cn("h-5 w-5", isRemoteActive && "text-primary")} />
                </Button>
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

/** Native HTML5 video player. iOS: tap-to-play (no autoplay), loading timeout hint. Windows: unchanged. */
export function LegacyVideoPreview({ file, downloadUrl, streamingLinks, subtitles, progressKey, startFromSeconds, onNext, onPrev, onPreload, onLoad, onError }: LegacyVideoPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hasPreloaded = useRef(false);
    const [error, setError] = useState(false);
    const [showCodecWarning, setShowCodecWarning] = useState(true);
    const ios = isIOS();
    const [iosTapToPlay, setIosTapToPlay] = useState(ios);
    const [showLoadingHint, setShowLoadingHint] = useState(false);
    const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [canStartPlayback, setCanStartPlayback] = useState(false);
    const [audioTrackCount, setAudioTrackCount] = useState(0);
    const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);
    const [subtitleSize, setSubtitleSize] = useState(24);
    const [subtitlePosition, setSubtitlePosition] = useState(64);
    const [playbackRate, setPlaybackRate] = useState(1);
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
    const osdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showOsd = useCallback((text: string) => {
        setOsdText(text);
        if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
        osdTimeoutRef.current = setTimeout(() => setOsdText(""), 800);
    }, []);

    // Control bar auto-hide
    const [showControls, setShowControls] = useState(true);
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
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number | -1>(-1); // Default to off, but will auto-enable

    // Progress tracking for continue watching
    const { initialProgress, updateProgress, forceSync, markCompleted } = useProgress(progressKey ?? null);
    const { scrobble } = useTraktScrobble(progressKey ?? null);
    const lastProgressUpdateRef = useRef<number>(0);
    const hasSeenkedToInitialRef = useRef(false);
    const PROGRESS_UPDATE_INTERVAL = 5000; // Update localStorage every 5 seconds

    // Reset skipped-segment tracking whenever the episode changes
    const prevProgressKeyRef = useRef(progressKey);
    useEffect(() => {
        if (prevProgressKeyRef.current !== progressKey) {
            prevProgressKeyRef.current = progressKey;
            skippedSegmentsRef.current = new Set();
            if (skipGraceTimerRef.current) {
                clearTimeout(skipGraceTimerRef.current);
                skipGraceTimerRef.current = null;
            }
            setActiveSkipSegment(null);
        }
    }, [progressKey]);

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
            const seekTo = startFromSeconds ?? initialProgress;
            if (seekTo && seekTo > 0 && Number.isFinite(video.duration)) {
                // Only seek if within valid range (not at the end)
                if (seekTo < video.duration - 5) {
                    video.currentTime = seekTo;
                    const mins = Math.floor(seekTo / 60);
                    const secs = Math.floor(seekTo % 60);
                    toast.info(`Resumed at ${mins}:${secs.toString().padStart(2, "0")}`, { duration: 2000 });
                }
            }
        }

        // Auto-enable subtitle track matching user's preferred language
        if (subtitles && subtitles.length > 0 && activeSubtitleIndex === -1 && preferredSubLang) {
            const langIndex = subtitles.findIndex((s) => isSubtitleLanguage(s, preferredSubLang));
            const bestIndex = langIndex !== -1 ? langIndex : subtitles.findIndex((s) => s.url);

            if (bestIndex !== -1) {
                setActiveSubtitleIndex(bestIndex);
            }
        }

        onLoad?.();
    }, [onLoad, startFromSeconds, initialProgress, subtitles, activeSubtitleIndex, preferredSubLang]);

    // Cross-device resume: if server progress arrives after the video has already loaded
    // and the user hasn't watched much yet (< 5s), apply the position now.
    useEffect(() => {
        if (initialProgress === null || !hasSeenkedToInitialRef.current) return;
        const video = videoRef.current;
        if (!video || video.currentTime >= 5) return;
        if (initialProgress > 5 && initialProgress < video.duration - 5) {
            video.currentTime = initialProgress;
            const mins = Math.floor(initialProgress / 60);
            const secs = Math.floor(initialProgress % 60);
            toast.info(`Resumed at ${mins}:${secs.toString().padStart(2, "0")}`, { duration: 2000 });
        }
    }, [initialProgress]);

    // Watch for subtitles arriving later (e.g. from async fetch)
    useEffect(() => {
        if (subtitles?.length && activeSubtitleIndex === -1 && !isLoading && preferredSubLang) {
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
                toast.info("Trying transcoded stream...", {
                    description: "The original format wasn't supported. Switching to a compatible format.",
                    duration: 3000,
                });
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

            fetch(`/api/addon/resolve?url=${encodeURIComponent(downloadUrl)}`)
                .then(r => r.ok ? r.json() as Promise<{ url?: string; status?: number }> : null)
                .then(data => {
                    const resolvedUrl = data?.url;
                    if (resolvedUrl && resolvedUrl !== downloadUrl && (data?.status ?? 999) < 400) {
                        toast.info("Retrying with resolved stream...", { duration: 2000 });
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
                    toast.error("Failed to load video", {
                        description: "The video could not be loaded. Try an external player like VLC.",
                        duration: 5000,
                    });
                    onError?.(new Error("Failed to load video"));
                })
                .catch(() => {
                    setError(true);
                    setIsLoading(false);
                    toast.error("Failed to load video", {
                        description: "The video could not be loaded. Try an external player like VLC.",
                        duration: 5000,
                    });
                    onError?.(new Error("Failed to load video"));
                });
            return;
        }

        setError(true);
        const errorMessage = "Failed to load video";
        toast.error(errorMessage, {
            description: hasCodecIssue 
                ? "This video format isn't supported by your browser. Try opening in an external player like VLC."
                : "The video could not be loaded. This might be due to an unsupported format or a network issue.",
            duration: 5000,
        });
        onError?.(new Error(errorMessage));
    }, [onError, triedTranscodeFallback, streamingLinks, isUsingTranscodedStream, effectiveUrl, hasCodecIssue, downloadUrl]);

    const handleLoadedMetadata = useCallback(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: { enabled: boolean; label?: string; language?: string } };
        }) | null;
        if (el?.audioTracks) {
            setAudioTrackCount(el.audioTracks.length);

            const tracks = el.audioTracks;
            let chosenIndex = 0;

            // Priority 1: user's preferred audio language from settings
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

            // Priority 2: Trakt original language (e.g. "en")
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

            // Priority 3: fall back to browser default / "original" labels
            if (chosenIndex === 0 && tracks.length > 1) {
                let originalIndex = 0;

                // Browser default (already enabled)
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

                chosenIndex = originalIndex;
            }

            setSelectedAudioIndex(chosenIndex);
        }
        if (el) {
            setDuration(el.duration || 0);
            setVolume(el.volume);
            setIsMuted(el.muted);
        }
    }, [originalLanguageCode, preferredAudioLang]);



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
    }, [selectedAudioIndex, audioTrackCount]);

    // Sync basic media state for custom controls.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onPlay = () => {
            setIsPlaying(true);
            setIsLoading(false);
            // Trakt scrobble start
            const dur = video.duration || 0;
            if (dur > 0) scrobble("start", (video.currentTime / dur) * 100);
        };
        const onPause = () => {
            setIsPlaying(false);
            // Sync progress to DB on pause
            forceSync();
            // Trakt scrobble pause
            const dur = video.duration || 0;
            if (dur > 0) scrobble("pause", (video.currentTime / dur) * 100);
        };
        const onTimeUpdate = () => {
            const time = video.currentTime || 0;
            const dur = video.duration || 0;
            setCurrentTime(time);
            if (!duration && Number.isFinite(dur)) setDuration(dur);

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
            const now = Date.now();
            if (progressKey && now - lastProgressUpdateRef.current >= PROGRESS_UPDATE_INTERVAL) {
                lastProgressUpdateRef.current = now;
                updateProgress(time, dur);
            }

            // Mark completed at 95%
            if (progressKey && dur > 0 && time / dur > 0.95) {
                markCompleted();
            }
        };
        const onWaiting = () => setIsLoading(true);
        const onPlaying = () => {
            setIsLoading(false);
            setIsPlaying(true);
        };
        const onDurationChange = () => setDuration(video.duration || 0);
        const onVolumeChange = () => {
            setVolume(video.volume);
            setIsMuted(video.muted || video.volume === 0);
        };
        const onEnded = () => {
            // Trakt scrobble stop (progress >= 80% → Trakt marks as watched)
            scrobble("stop", 100);
            // Mark as completed when video ends (> 95% watched)
            if (progressKey) {
                markCompleted();
            }
            // Auto-next if available
            if (onNext) onNext();
        };

        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("playing", onPlaying);
        video.addEventListener("durationchange", onDurationChange);
        video.addEventListener("volumechange", onVolumeChange);
        video.addEventListener("ended", onEnded);

        return () => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("waiting", onWaiting);
            video.removeEventListener("playing", onPlaying);
            video.removeEventListener("durationchange", onDurationChange);
            video.removeEventListener("volumechange", onVolumeChange);
            video.removeEventListener("ended", onEnded);
            if (skipGraceTimerRef.current) {
                clearTimeout(skipGraceTimerRef.current);
                skipGraceTimerRef.current = null;
            }
        };
    }, [duration, progressKey, updateProgress, forceSync, markCompleted, onNext, onPreload, scrobble, autoSkipIntro, introSegments]);


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

    // Control bar auto-hide (3s inactivity)
    const resetControlsTimeout = useCallback(() => {
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        setShowControls(true);
        controlsTimeoutRef.current = setTimeout(() => {
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
        container.addEventListener("touchstart", handleActivity);
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
            void el.play();
        } else {
            el.pause();
        }
    }, []);

    const seekTo = useCallback((time: number) => {
        const el = videoRef.current;
        if (!el || !Number.isFinite(el.duration)) return;
        el.currentTime = Math.min(Math.max(time, 0), el.duration);
        setCurrentTime(el.currentTime);
    }, []);

    const handleSeekChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) seekTo(value);
        },
        [seekTo]
    );

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

    const [openMenu, setOpenMenu] = useState<"subtitles" | "audio" | "settings" | null>(null);

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

            // Blur focused player controls (buttons, seekbar) so shortcuts work
            if (
                active &&
                active !== document.body &&
                (active.tagName === "BUTTON" || (active as HTMLInputElement).type === "range")
            ) {
                (active as HTMLElement).blur();
            }

            switch (event.key) {
                case "Escape":
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
                    showOsd(videoRef.current?.paused ? "▶ Play" : "⏸ Pause");
                    break;
                case "ArrowLeft":
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) - 5);
                    showOsd("« 5s");
                    break;
                case "ArrowRight":
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) + 5);
                    showOsd("» 5s");
                    break;
                case "j":
                case "J":
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) - 10);
                    showOsd("« 10s");
                    break;
                case "l":
                case "L":
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) + 10);
                    showOsd("» 10s");
                    break;
                case ",":
                case "<":
                    if (videoRef.current?.paused) {
                        event.preventDefault();
                        seekTo((videoRef.current?.currentTime ?? 0) - 0.5);
                    }
                    break;
                case ".":
                case ">":
                    if (videoRef.current?.paused) {
                        event.preventDefault();
                        seekTo((videoRef.current?.currentTime ?? 0) + 0.5);
                    }
                    break;
                case "[":
                    event.preventDefault();
                    setPlaybackRate((prev) => {
                        const next = Math.max(0.25, +(prev - 0.25).toFixed(2));
                        showOsd(`Speed ${next}x`);
                        return next;
                    });
                    break;
                case "]":
                    event.preventDefault();
                    setPlaybackRate((prev) => {
                        const next = Math.min(4, +(prev + 0.25).toFixed(2));
                        showOsd(`Speed ${next}x`);
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
                    showOsd(`Volume ${Math.round(next * 100)}%`);
                    break;
                }
                case "m":
                case "M":
                    event.preventDefault();
                    toggleMute();
                    showOsd(videoRef.current?.muted ? "🔇 Muted" : "🔊 Unmuted");
                    break;
                case "f":
                case "F":
                    event.preventDefault();
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
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [subtitles, togglePlay, toggleMute, toggleFullscreen, seekTo, showOsd, fakeFullscreen]);

    // Remote subtitle switching via device sync custom event
    useEffect(() => {
        const subHandler = (e: Event) => {
            const trackId = (e as CustomEvent).detail?.trackId as number | undefined;
            if (trackId !== undefined) {
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

    // If we have subtitles, "warm up" the default subtitle by hitting our proxy first.
    // This allows the proxy to convert SRT->VTT before the browser starts video playback, similar to Stremio web.
    useEffect(() => {
        const first = subtitles?.[0];
        if (!first?.url) {
            setCanStartPlayback(true);
            return;
        }

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
    }, [subtitles]);

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
            const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(s);
            if (!m) return null;
            const hh = Number(m[1]);
            const mm = Number(m[2]);
            const ss = Number(m[3]);
            const ms = Number((m[4] ?? "0").padEnd(3, "0"));
            return hh * 3600 + mm * 60 + ss + ms / 1000;
        };

        const parseCuesFromText = (text: string): SubtitleCue[] => {
            const cues: SubtitleCue[] = [];
            const raw = text.replace(/\r\n/g, "\n").trim();
            const body = raw.startsWith("WEBVTT") ? raw.replace(/^WEBVTT[^\n]*\n+/, "") : raw;
            const blocks = body.split(/\n{2,}/);

            for (const block of blocks) {
                const lines = block.split("\n").filter(Boolean);
                if (lines.length < 2) continue;

                const timeLineIdx = /^\d+$/.test(lines[0]!) ? 1 : 0;
                const timeLine = lines[timeLineIdx];
                if (!timeLine?.includes("-->")) continue;

                const [startRaw, endRaw] = timeLine.split("-->").map((p) => p.trim());
                const start = parseTime(startRaw);
                const end = parseTime(endRaw.split(/\s+/)[0] ?? "");
                if (start == null || end == null) continue;

                const cueText = lines.slice(timeLineIdx + 1).join("\n")
                    // Strip SSA/ASS style tags: {\an8}, {\i1}, etc.
                    .replace(/\{[^}]+\}/g, "")
                    // Strip HTML formatting tags: <i>, </i>, <b>, <font ...>, etc.
                    .replace(/<\/?[^>]+(>|$)/g, "")
                    .trim();
                cues.push({ start, end, text: cueText });
            }
            return cues;
        };

        const run = async () => {
            // Disable all existing subtitle/caption tracks (including embedded).
            const existing = Array.from(el.textTracks ?? []).filter(
                (t) => t.kind === "subtitles" || t.kind === "captions"
            );
            for (const t of existing) t.mode = "disabled";

            const allCues: SubtitleCue[][] = [];
            for (const sub of subtitles) {
                if (!sub.url || !sub.lang) {
                    allCues.push([]);
                    continue;
                }

                try {
                    const res = await fetch(getProxyUrl(sub.url), { signal: controller.signal });
                    if (!res.ok) {
                        allCues.push([]);
                        continue;
                    }
                    const txt = await res.text();
                    allCues.push(parseCuesFromText(txt));
                } catch {
                    allCues.push([]);
                }
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
        // Find the cue that matches currentTime
        const activeCue = cues.find((c) => currentTime >= c.start && currentTime < c.end);
        setActiveCueText(activeCue?.text ?? "");
    }, [activeSubtitleIndex, parsedCues, currentTime]);

    // iOS: ensure playsinline (and webkit prefix for older Safari)
    useEffect(() => {
        const el = videoRef.current;
        if (el) el.setAttribute("webkit-playsinline", "true");
    }, []);

    return (
        <div
            ref={containerRef}
            className={cn(
                "relative w-full h-full flex flex-col bg-black debridui-legacy-player group",
                fakeFullscreen && "fixed inset-0 z-[9999]"
            )}
            onClick={(e) => {
                if (e.target === containerRef.current || (e.target as HTMLElement).tagName === "VIDEO") {
                    togglePlay();
                }
            }}>
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

                    {/* Unified loading overlay — subtitle prep takes priority */}
                    {(!canStartPlayback || (isLoading && !error)) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 z-40">
                            <Loader2 className="h-10 w-10 text-white animate-spin" />
                            {!canStartPlayback && (
                                <p className="text-xs tracking-widest uppercase text-white/50">Preparing subtitles</p>
                            )}
                        </div>
                    )}

                    {/* Big Center Play/Pause Overlay */}
                    {!isLoading && (
                        <div
                            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 z-25 pointer-events-none ${(!isPlaying || showControls) ? "opacity-100 scale-100" : "opacity-0 scale-90"}`}
                        >
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlay();
                                }}
                                className="pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:scale-110 active:scale-95 border border-white/10"
                            >
                                {isPlaying ? (
                                    <Pause className="h-10 w-10 fill-current" />
                                ) : (
                                    <Play className="h-10 w-10 fill-current ml-1" />
                                )}
                            </button>
                        </div>
                    )}

                    {/* In-player OSD for keyboard shortcut feedback */}
                    {osdText && (
                        <div
                            key={osdText}
                            className="absolute top-12 right-5 z-40 pointer-events-none animate-in fade-in slide-in-from-right-2 duration-200"
                        >
                            <div className="rounded-sm bg-black/80 px-4 py-2 text-sm font-medium tracking-wide text-white/90">
                                {osdText}
                            </div>
                        </div>
                    )}

                    <VideoCodecWarning
                        show={shouldShowWarning && showCodecWarning}
                        isPlaying={isPlaying}
                        onClose={() => setShowCodecWarning(false)}
                        onOpenInPlayer={openInExternalPlayer}
                    />

                    {/* Manual subtitle overlay */}
                    {activeCueText && (
                        <div
                            className="debridui-subtitle-overlay pointer-events-none absolute inset-x-0 z-15 flex justify-center px-4"
                            style={{ bottom: `${subtitlePosition}px` }}
                            aria-live="polite">
                            <span
                                className="debridui-subtitle-text inline-block max-w-[90%] text-center px-3 py-1.5 rounded-sm"
                                style={{ fontSize: `${subtitleSize}px` }}
                            >
                                {activeCueText.split("\n").map((line, i) => (
                                    <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
                                ))}
                            </span>
                        </div>
                    )}

                    {/* IntroDB: Skip Intro / Skip Recap / Skip Credits button */}
                    {activeSkipSegment && !autoSkipIntro && (
                        <div className="absolute bottom-24 right-4 z-45 flex items-center gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
                                className="flex items-center gap-2 rounded-sm border border-white/30 bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20 active:scale-95">
                                <SkipForward className="size-4" />
                                {activeSkipSegment === 'intro' ? 'Skip Intro' : activeSkipSegment === 'recap' ? 'Skip Recap' : 'Skip Credits'}
                            </button>
                            <button
                                type="button"
                                aria-label="Dismiss"
                                onClick={() => {
                                    skippedSegmentsRef.current.add(activeSkipSegment);
                                    setActiveSkipSegment(null);
                                }}
                                className="flex items-center justify-center rounded-sm border border-white/30 bg-black/70 p-2 text-white/60 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white active:scale-95">
                                <X className="size-3" />
                            </button>
                        </div>
                    )}

                    {/* Custom control bar */}
                    <div
                        className={`pointer-events-none absolute inset-x-0 bottom-0 z-40 transition-all duration-300 ${showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}>
                            <div className="pointer-events-auto bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-3 pt-12">
                                {/* Seek bar */}
                                <div className="group/seekbar relative flex items-center gap-3">
                                    {/* IntroDB segment markers on seekbar */}
                                    {introSegments && duration > 0 && (
                                        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                                            {(['intro', 'recap', 'outro'] as const).map((type) => {
                                                const seg = introSegments[type];
                                                if (!seg) return null;
                                                const left = (seg.start_sec / duration) * 100;
                                                const width = ((seg.end_sec - seg.start_sec) / duration) * 100;
                                                const colorClass = type === 'intro' ? 'bg-primary/80' : type === 'recap' ? 'bg-primary/50' : 'bg-primary/30';
                                                return (
                                                    <div
                                                        key={type}
                                                        title={type === 'intro' ? 'Intro' : type === 'recap' ? 'Recap' : 'Credits'}
                                                        className={`absolute top-1/2 -translate-y-1/2 h-2 rounded-full ${colorClass}`}
                                                        style={{ left: `${left}%`, width: `${width}%` }}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                    <input
                                        type="range"
                                        min={0}
                                        max={Number.isFinite(duration) && duration > 0 ? duration : 0}
                                        step={0.1}
                                        value={Number.isFinite(currentTime) ? currentTime : 0}
                                        onChange={handleSeekChange}
                                        style={{
                                            background: `linear-gradient(to right, var(--primary) ${(duration > 0 ? (currentTime / duration) * 100 : 0)}%, rgba(255, 255, 255, 0.3) ${(duration > 0 ? (currentTime / duration) * 100 : 0)}%)`
                                        }}
                                        className="h-1 w-full cursor-pointer appearance-none rounded-full accent-primary transition-all group-hover/seekbar:h-1.5"
                                    />
                                </div>

                                {/* Controls row */}
                                <div className="mt-4 flex items-center gap-2 text-xs text-white">
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-9 w-9 text-white hover:bg-white/20"
                                            onClick={togglePlay}
                                            disabled={isLoading}
                                            aria-label={isPlaying ? "Pause" : "Play"}>
                                            {isLoading ? (
                                                <Loader2 className="h-5 w-5 animate-spin text-white/50" />
                                            ) : isPlaying ? (
                                                <Pause className="h-5 w-5 fill-current" />
                                            ) : (
                                                <Play className="h-5 w-5 fill-current" />
                                            )}
                                        </Button>

                                        {/* Next/Prev Buttons */}
                                        <div className="flex items-center">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 text-white hover:bg-white/20 disabled:opacity-30"
                                                onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
                                                disabled={!onPrev}
                                                title="Previous episode">
                                                <SkipBack className="h-5 w-5 fill-current" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 text-white hover:bg-white/20 disabled:opacity-30"
                                                onClick={(e) => { e.stopPropagation(); onNext?.(); }}
                                                disabled={!onNext}
                                                title="Next episode">
                                                <SkipForward className="h-5 w-5 fill-current" />
                                            </Button>
                                        </div>

                                        <span className="text-sm font-medium tabular-nums ml-2">
                                            {formatTime(currentTime)}{" "}
                                            <span className="text-white/40 mx-1">/</span>
                                            <span className="text-white/60">{formatTime(duration)}</span>
                                        </span>
                                    </div>

                                    {/* Volume */}
                                    <div className="flex items-center gap-1 group/volume ml-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-9 w-9 text-white hover:bg-white/20"
                                            onClick={toggleMute}
                                            aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}>
                                            {isMuted || volume === 0 ? (
                                                <VolumeX className="h-5 w-5" />
                                            ) : (
                                                <Volume2 className="h-5 w-5" />
                                            )}
                                        </Button>
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={isMuted ? 0 : volume}
                                            onChange={handleVolumeChange}
                                            style={{
                                                background: `linear-gradient(to right, var(--primary) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.3) ${(isMuted ? 0 : volume) * 100}%)`
                                            }}
                                            className="h-1 w-0 cursor-pointer appearance-none rounded-full overflow-hidden accent-primary transition-all duration-300 group-hover/volume:w-20 group-hover/volume:overflow-visible"
                                        />
                                    </div>

                                    <div className="ml-auto flex items-center gap-3">
                                        {/* Audio track selector */}
                                        {audioTrackCount > 1 && (
                                            <DropdownMenu
                                                open={openMenu === "audio"}
                                                onOpenChange={(open) =>
                                                    setOpenMenu(open ? "audio" : null)
                                                }>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-9 px-3 text-xs font-medium text-white hover:bg-white/20 rounded-md border border-white/10">
                                                        Audio
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        className="min-w-[180px] z-50 bg-black/90 text-white border-white/10 backdrop-blur-md p-1">
                                                        <DropdownMenuLabel className="text-[10px] tracking-widest uppercase text-white/40 px-3 py-2">
                                                            Audio Tracks
                                                        </DropdownMenuLabel>
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
                                                                <DropdownMenuItem
                                                                    key={i}
                                                                    onClick={() => setSelectedAudioIndex(i)}
                                                                    className={
                                                                        selectedAudioIndex === i
                                                                            ? "bg-primary text-primary-foreground"
                                                                            : "focus:bg-white/10 focus:text-white"
                                                                    }>
                                                                    {label}
                                                                </DropdownMenuItem>
                                                            );
                                                        })}
                                                    </DropdownMenuContent>
                                                </DropdownMenuPortal>
                                            </DropdownMenu>
                                        )}

                                        {/* Subtitles menu (track selection only) */}
                                        {subtitles && subtitles.length > 0 && (
                                            <DropdownMenu
                                                open={openMenu === "subtitles"}
                                                onOpenChange={(open) =>
                                                    setOpenMenu(open ? "subtitles" : null)
                                                }>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-9 px-3 text-xs font-bold text-white hover:bg-white/20 rounded-md border border-white/10">
                                                        CC
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        className="min-w-[160px] z-50 bg-black/90 text-white border-white/10 backdrop-blur-md p-1">
                                                        <DropdownMenuLabel className="text-[10px] tracking-widest uppercase text-white/40 px-3 py-2">
                                                            Subtitles
                                                        </DropdownMenuLabel>
                                                        <DropdownMenuItem
                                                            onClick={() => setActiveSubtitleIndex(-1)}
                                                            className={
                                                                activeSubtitleIndex === -1
                                                                    ? "bg-primary text-primary-foreground"
                                                                    : "focus:bg-white/10 focus:text-white"
                                                            }>
                                                            Off
                                                        </DropdownMenuItem>
                                                        {subtitles.map((sub, i) => (
                                                            <DropdownMenuItem
                                                                key={`${sub.lang}-${sub.url}-${i}`}
                                                                onClick={() => setActiveSubtitleIndex(i)}
                                                                className={
                                                                    activeSubtitleIndex === i
                                                                        ? "bg-primary text-primary-foreground"
                                                                        : "focus:bg-white/10 focus:text-white"
                                                                }>
                                                                {sub.name ?? getLanguageDisplayName(sub.lang)}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </DropdownMenuContent>
                                                </DropdownMenuPortal>
                                            </DropdownMenu>
                                        )}

                                        {/* Settings menu (speed, subtitle size/position) */}
                                        <DropdownMenu
                                            open={openMenu === "settings"}
                                            onOpenChange={(open) =>
                                                setOpenMenu(open ? "settings" : null)
                                            }>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9 text-white hover:bg-white/20">
                                                    <Settings className="h-5 w-5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    align="end"
                                                    className="min-w-[200px] z-50 bg-black/90 text-white border-white/10 backdrop-blur-md p-2">
                                                    {/* Playback speed */}
                                                    <DropdownMenuLabel className="text-[10px] tracking-widest uppercase text-white/40 px-2 py-2">
                                                        Playback Speed
                                                    </DropdownMenuLabel>
                                                    <div className="grid grid-cols-3 gap-1 px-1 pb-2">
                                                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                                                            <button
                                                                key={rate}
                                                                onClick={() => setPlaybackRate(rate)}
                                                                className={`rounded px-1 py-1.5 text-[10px] font-medium transition-colors ${playbackRate === rate ? "bg-primary text-primary-foreground" : "hover:bg-white/10"}`}
                                                            >
                                                                {rate === 1 ? "Normal" : `${rate}x`}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    <div className="h-px bg-white/10 my-2" />

                                                    {/* Subtitle size +/− */}
                                                    <DropdownMenuLabel className="text-[10px] tracking-widest uppercase text-white/40 px-2 py-2">
                                                        Subtitle Size
                                                    </DropdownMenuLabel>
                                                    <div className="flex items-center justify-between px-2 pb-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10"
                                                            onClick={() => setSubtitleSize((s) => Math.max(12, s - 2))}>
                                                            <Minus className="h-4 w-4" />
                                                        </Button>
                                                        <span className="text-xs font-mono">{subtitleSize}px</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10"
                                                            onClick={() => setSubtitleSize((s) => Math.min(64, s + 2))}>
                                                            <Plus className="h-4 w-4" />
                                                        </Button>
                                                    </div>

                                                    {/* Subtitle position +/− */}
                                                    <DropdownMenuLabel className="text-[10px] tracking-widest uppercase text-white/40 px-2 py-2">
                                                        Subtitle Position
                                                    </DropdownMenuLabel>
                                                    <div className="flex items-center justify-between px-2 pb-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10"
                                                            onClick={() => setSubtitlePosition((s) => Math.max(20, s - 4))}>
                                                            <Minus className="h-4 w-4" />
                                                        </Button>
                                                        <span className="text-xs font-mono">{subtitlePosition}px</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10"
                                                            onClick={() => setSubtitlePosition((s) => Math.min(400, s + 4))}>
                                                            <Plus className="h-4 w-4" />
                                                        </Button>
                                                    </div>

                                                    <div className="h-px bg-white/10 my-2" />

                                                    {/* Open in external player — platform-filtered */}
                                                    <DropdownMenuLabel className="text-[10px] tracking-widest uppercase text-white/40 px-2 py-2">
                                                        Open In
                                                    </DropdownMenuLabel>
                                                    <div className="space-y-0.5 px-1 pb-1">
                                                        {Object.values(MediaPlayer)
                                                            .filter((p) => p !== MediaPlayer.BROWSER && isSupportedPlayer(p))
                                                            .map((player) => (
                                                                <DropdownMenuItem
                                                                    key={player}
                                                                    onClick={() => openInExternalPlayer(player)}
                                                                    className="gap-2 focus:bg-white/10 focus:text-white">
                                                                    <ExternalLink className="size-3.5" /> {player}
                                                                </DropdownMenuItem>
                                                            ))}
                                                    </div>

                                                    {/* PiP */}
                                                    {document.pictureInPictureEnabled && (
                                                        <>
                                                            <div className="h-px bg-white/10 my-2" />
                                                            <DropdownMenuItem
                                                                onClick={() => {
                                                                    const video = videoRef.current;
                                                                    if (!video) return;
                                                                    if (document.pictureInPictureElement) {
                                                                        document.exitPictureInPicture();
                                                                    } else {
                                                                        video.requestPictureInPicture().catch(() => {});
                                                                    }
                                                                }}
                                                                className="gap-2 focus:bg-white/10 focus:text-white mx-1">
                                                                <PictureInPicture2 className="size-3.5" /> Picture in Picture
                                                            </DropdownMenuItem>
                                                        </>
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
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-9 w-9 text-white hover:bg-white/20"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleFullscreen();
                                            }}
                                            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
                                            {isFullscreen ? (
                                                <Minimize2 className="h-5 w-5" />
                                            ) : (
                                                <Maximize2 className="h-5 w-5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>

                    {/* iOS: tap-to-play overlay so playback runs in user gesture context */}
                    {ios && iosTapToPlay && (
                        <button
                            type="button"
                            onClick={handleIosTapToPlay}
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
                        <div className="absolute bottom-14 left-0 right-0 px-4 py-3 bg-black/90 text-white text-center text-xs z-50 backdrop-blur-md border-t border-white/10">
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
