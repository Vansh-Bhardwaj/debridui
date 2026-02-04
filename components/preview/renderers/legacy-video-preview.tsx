"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, Settings, Plus, Minus, ExternalLink, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { getProxyUrl, isNonMP4Video, openInPlayer } from "@/lib/utils";
import type { AddonSubtitle } from "@/lib/addons/types";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LegacyPlayerSubtitleStyle } from "@/components/preview/legacy-player-subtitle-style";

/** Parsed subtitle cue for manual rendering */
interface SubtitleCue {
    start: number;
    end: number;
    text: string;
}

/** iOS Safari requires user gesture to start playback and often requires Range request support from the server. */
function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function getLanguageDisplayName(rawLang: string): string {
    const lang = rawLang.trim();
    if (!lang) return "";
    if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(lang)) return lang;

    const base = lang.split("-")[0]!.toLowerCase();
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
    };
    const bcp47 = base.length === 3 ? iso639_2_to_1[base] ?? base : base;
    try {
        const dn = new Intl.DisplayNames(["en"], { type: "language" });
        return dn.of(bcp47) ?? rawLang;
    } catch {
        return rawLang;
    }
}

export interface LegacyVideoPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    streamingLinks?: Record<string, string>;
    subtitles?: AddonSubtitle[];
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

const LOADING_HINT_AFTER_MS = 12000;

/** Native HTML5 video player. iOS: tap-to-play (no autoplay), loading timeout hint. Windows: unchanged. */
export function LegacyVideoPreview({ file, downloadUrl, streamingLinks, subtitles, onLoad, onError }: LegacyVideoPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState(false);
    const [showCodecWarning, setShowCodecWarning] = useState(true);
    const ios = isIOS();
    const [iosTapToPlay, setIosTapToPlay] = useState(ios);
    const [showLoadingHint, setShowLoadingHint] = useState(false);
    const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [canStartPlayback, setCanStartPlayback] = useState(() => ios);
    const [audioTrackCount, setAudioTrackCount] = useState(0);
    const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);
    const [subtitleSize, setSubtitleSize] = useState(24);
    const [subtitlePosition, setSubtitlePosition] = useState(64);
    const [playbackRate, setPlaybackRate] = useState(1);

    // Manual subtitle rendering (bypasses Windows OS caption override)
    const [parsedCues, setParsedCues] = useState<SubtitleCue[][]>([]);
    const [activeCueText, setActiveCueText] = useState<string>("");

    // Control bar auto-hide
    const [showControls, setShowControls] = useState(true);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hasCodecIssue = isNonMP4Video(file.name);
    const hasShownToastRef = useRef(false);

    // Prioritize Apple-native streaming link on iOS (usually HLS/m3u8)
    const effectiveUrl = (ios && streamingLinks)
        ? (streamingLinks.apple || streamingLinks.native || downloadUrl)
        : downloadUrl;

    // Suppress warning if we have a native streaming link that handles the codec
    const shouldShowWarning = hasCodecIssue && (!ios || !streamingLinks?.apple);

    const openInExternalPlayer = useCallback(
        (player: MediaPlayer) => {
            videoRef.current?.pause();
            openInPlayer({ url: downloadUrl, fileName: file.name, player });
            setShowCodecWarning(false);
            setShowLoadingHint(false);
        },
        [downloadUrl, file.name]
    );

    // One-time codec warning toast
    useEffect(() => {
        if (shouldShowWarning && showCodecWarning && !hasShownToastRef.current) {
            hasShownToastRef.current = true;
            toast.warning("Audio/Codec issues detected in browser", {
                description: "This non-MP4 file (MKV, AVI, etc.) may not play correctly. Open in an external player for full support.",
                duration: 8000,
                action: {
                    label: "Open in VLC",
                    onClick: () => openInExternalPlayer(MediaPlayer.VLC)
                },
                onAutoClose: () => setShowCodecWarning(false),
                onDismiss: () => setShowCodecWarning(false),
            });
        }
    }, [shouldShowWarning, showCodecWarning, openInExternalPlayer]);

    const [iosDidStartPlayback, setIosDidStartPlayback] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const handleLoad = useCallback(() => {
        if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
        }
        setShowLoadingHint(false);
        onLoad?.();
    }, [onLoad]);

    const handleError = useCallback(() => {
        if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
        }
        setShowLoadingHint(false);
        setError(true);
        const errorMessage = "Failed to load video";
        toast.error(errorMessage, {
            description: "The video could not be loaded. This might be due to an unsupported format or a network issue.",
            duration: 5000,
        });
        onError?.(new Error(errorMessage));
    }, [onError]);

    const handleLoadedMetadata = useCallback(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: { enabled: boolean; label?: string; language?: string } };
        }) | null;
        if (el?.audioTracks) setAudioTrackCount(el.audioTracks.length);
        if (el) {
            setDuration(el.duration || 0);
            setVolume(el.volume);
            setIsMuted(el.muted);
        }
    }, []);

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

    // Sync basic media state for custom controls (non-iOS).
    useEffect(() => {
        const video = videoRef.current;
        if (!video || ios) return;

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onTimeUpdate = () => {
            setCurrentTime(video.currentTime || 0);
            if (!duration && Number.isFinite(video.duration)) setDuration(video.duration);
        };
        const onDurationChange = () => setDuration(video.duration || 0);
        const onVolumeChange = () => {
            setVolume(video.volume);
            setIsMuted(video.muted || video.volume === 0);
        };

        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("durationchange", onDurationChange);
        video.addEventListener("volumechange", onVolumeChange);

        return () => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("durationchange", onDurationChange);
            video.removeEventListener("volumechange", onVolumeChange);
        };
    }, [ios, duration]);

    // Keep fullscreen state in sync
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
        controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }, []);

    useEffect(() => {
        if (ios) return;
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
    }, [ios, resetControlsTimeout]);

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

    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const fsElement =
            document.fullscreenElement ||
            // @ts-expect-error - vendor-prefixed
            document.webkitFullscreenElement;
        if (!fsElement) {
            if (el.requestFullscreen) {
                void el.requestFullscreen();
            }
        } else if (document.exitFullscreen) {
            void document.exitFullscreen();
        }
    }, []);

    const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number | -1>(0);
    const [openMenu, setOpenMenu] = useState<"subtitles" | "audio" | "external" | "settings" | null>(null);

    // When subtitle selection changes (non-iOS), toggle textTracks modes (also disables embedded tracks).
    useEffect(() => {
        if (ios) return;
        const el = videoRef.current;
        if (!el) return;
        const tracks = el.textTracks;
        if (!tracks) return;

        const activeSub = activeSubtitleIndex >= 0 ? subtitles?.[activeSubtitleIndex] : undefined;
        const activeLabel = activeSub ? activeSub.name ?? activeSub.lang : undefined;

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
    }, [activeSubtitleIndex, ios, subtitles]);

    const formatTime = (value: number): string => {
        if (!Number.isFinite(value) || value < 0) return "0:00";
        const total = Math.floor(value);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
        const ss = String(s).padStart(2, "0");
        return h > 0 ? `${h}:${mm}:${ss} ` : `${mm}:${ss} `;
    };

    // iOS: start loading timeout when video starts loading; show hint if it never reaches canplay
    useEffect(() => {
        const el = videoRef.current;
        if (!el || !ios) return;

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
    }, [ios]);

    const handleIosTapToPlay = useCallback(() => {
        setIosTapToPlay(false);
        setIosDidStartPlayback(true);
        videoRef.current?.play();
    }, []);

    // Keyboard shortcuts (non-iOS): play/pause, seek, volume, mute, fullscreen, subtitles.
    useEffect(() => {
        if (ios) return;

        const handler = (event: KeyboardEvent) => {
            const active = document.activeElement;
            if (
                active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    (active as HTMLElement).isContentEditable)
            ) {
                return;
            }

            switch (event.key) {
                case " ":
                case "k":
                case "K":
                    event.preventDefault();
                    togglePlay();
                    break;
                case "ArrowLeft":
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) - 5);
                    break;
                case "ArrowRight":
                    event.preventDefault();
                    seekTo((videoRef.current?.currentTime ?? 0) + 5);
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
                    break;
                }
                case "m":
                case "M":
                    event.preventDefault();
                    toggleMute();
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
                        if (prev === -1) return 0;
                        const next = prev + 1;
                        return next < subtitles.length ? next : -1;
                    });
                    break;
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [ios, subtitles, togglePlay, toggleMute, toggleFullscreen, seekTo]);

    // Non-iOS: if we have subtitles, "warm up" the default subtitle by hitting our proxy first.
    // This allows the proxy to convert SRT->VTT before the browser starts video playback, similar to Stremio web.
    useEffect(() => {
        if (ios) {
            setCanStartPlayback(true);
            return;
        }

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
    }, [ios, subtitles]);

    // Load addon subtitles and parse cues for manual overlay rendering.
    useEffect(() => {
        const el = videoRef.current;
        if (!el || !subtitles?.length) {
            setParsedCues([]);
            return;
        }
        if (ios && !iosDidStartPlayback) return;
        if (!ios && !canStartPlayback) return;

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
    }, [ios, iosDidStartPlayback, canStartPlayback, subtitles]);

    // Sync active cue text for manual overlay (bypasses Windows OS ::cue style override)
    useEffect(() => {
        if (ios || activeSubtitleIndex < 0) {
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
    }, [ios, activeSubtitleIndex, parsedCues, currentTime]);

    // iOS: ensure playsinline (and webkit prefix for older Safari)
    useEffect(() => {
        const el = videoRef.current;
        if (el) el.setAttribute("webkit-playsinline", "true");
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex flex-col bg-black debridui-legacy-player">
            <LegacyPlayerSubtitleStyle />
            {error ? (
                <div className="flex-1 flex flex-col items-center justify-center text-white">
                    <AlertCircle className="h-12 w-12 mb-2" />
                    <p className="text-sm">Failed to load video</p>
                    <p className="text-xs text-white/70 mt-1">{file.name}</p>
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0 relative">
                    <video
                        ref={videoRef}
                        src={canStartPlayback ? effectiveUrl : undefined}
                        controls={ios}
                        autoPlay={!ios && canStartPlayback}
                        playsInline
                        preload={ios ? "none" : "metadata"}
                        className="w-full h-full object-contain bg-black"
                        style={{ maxHeight: "100%" }}
                        onLoadedMetadata={handleLoadedMetadata}
                        onLoadedData={handleLoad}
                        onError={handleError}
                    />

                    {/* Non-iOS: brief "preparing subtitles" gate (proxy conversion) */}
                    {!ios && !canStartPlayback && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm z-10">
                            Preparing subtitles…
                        </div>
                    )}

                    {/* Manual subtitle overlay (bypasses Windows OS ::cue style override) */}
                    {!ios && activeCueText && (
                        <div
                            className="debridui-subtitle-overlay pointer-events-none absolute inset-x-0 z-15 flex justify-center px-4"
                            style={{ bottom: `${subtitlePosition}px` }}
                            aria-live="polite">
                            <span
                                className="debridui-subtitle-text inline-block max-w-[90%] text-center px-3 py-1.5 rounded-sm"
                                style={{ fontSize: `${subtitleSize}px` }}
                                dangerouslySetInnerHTML={{ __html: activeCueText.replace(/\n/g, "<br />") }}
                            />
                        </div>
                    )}

                    {/* Custom control bar (non-iOS) */}
                    {!ios && (
                        <div
                            className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0"}`}>
                            <div className="pointer-events-auto bg-gradient-to-t from-black/80 via-black/60 to-transparent px-4 pb-3 pt-6">
                                {/* Seek bar */}
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min={0}
                                        max={Number.isFinite(duration) && duration > 0 ? duration : 0}
                                        step={0.1}
                                        value={Number.isFinite(currentTime) ? currentTime : 0}
                                        onChange={handleSeekChange}
                                        className="w-full accent-primary"
                                    />
                                </div>

                                {/* Controls row */}
                                <div className="mt-2 flex items-center gap-3 text-xs text-white">
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-white hover:bg-white/10"
                                            onClick={togglePlay}
                                            aria-label={isPlaying ? "Pause" : "Play"}>
                                            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                        </Button>
                                        <span className="text-xs tabular-nums">
                                            {formatTime(currentTime)}{" "}
                                            <span className="text-white/50">/ {formatTime(duration)}</span>
                                        </span>
                                    </div>

                                    {/* Volume */}
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-white hover:bg-white/10"
                                            onClick={toggleMute}
                                            aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}>
                                            {isMuted || volume === 0 ? (
                                                <VolumeX className="h-4 w-4" />
                                            ) : (
                                                <Volume2 className="h-4 w-4" />
                                            )}
                                        </Button>
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={isMuted ? 0 : volume}
                                            onChange={handleVolumeChange}
                                            className="w-24 accent-primary"
                                        />
                                    </div>

                                    <div className="ml-auto flex items-center gap-2">
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
                                                        className="h-8 px-2 text-xs text-white hover:bg-white/10">
                                                        CC
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        className="min-w-[160px] z-50">
                                                        <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground">
                                                            Subtitles
                                                        </DropdownMenuLabel>
                                                        <DropdownMenuItem
                                                            onClick={() => setActiveSubtitleIndex(-1)}
                                                            className={
                                                                activeSubtitleIndex === -1
                                                                    ? "bg-accent text-accent-foreground"
                                                                    : ""
                                                            }>
                                                            Off
                                                        </DropdownMenuItem>
                                                        {subtitles.map((sub, i) => (
                                                            <DropdownMenuItem
                                                                key={`${sub.lang}-${sub.url}-${i}`}
                                                                onClick={() => setActiveSubtitleIndex(i)}
                                                                className={
                                                                    activeSubtitleIndex === i
                                                                        ? "bg-accent text-accent-foreground"
                                                                        : ""
                                                                }>
                                                                {sub.name ?? sub.lang}
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
                                                    className="h-8 w-8 text-white hover:bg-white/10">
                                                    <Settings className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    align="end"
                                                    className="min-w-[180px] z-50">
                                                    {/* Playback speed */}
                                                    <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground">
                                                        Speed
                                                    </DropdownMenuLabel>
                                                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                                                        <DropdownMenuItem
                                                            key={rate}
                                                            onClick={() => setPlaybackRate(rate)}
                                                            className={
                                                                playbackRate === rate
                                                                    ? "bg-accent text-accent-foreground"
                                                                    : ""
                                                            }>
                                                            {rate === 1 ? "Normal" : `${rate} x`}
                                                        </DropdownMenuItem>
                                                    ))}

                                                    {/* Subtitle size +/− */}
                                                    <DropdownMenuLabel className="mt-2 text-xs tracking-widest uppercase text-muted-foreground">
                                                        Subtitle size ({subtitleSize}px)
                                                    </DropdownMenuLabel>
                                                    <div className="flex items-center justify-between px-2 py-1.5">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => setSubtitleSize((s) => Math.max(12, s - 2))}>
                                                            <Minus className="h-3 w-3" />
                                                        </Button>
                                                        <span className="text-xs">{subtitleSize}px</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => setSubtitleSize((s) => Math.min(64, s + 2))}>
                                                            <Plus className="h-3 w-3" />
                                                        </Button>
                                                    </div>

                                                    {/* Subtitle position +/− */}
                                                    <DropdownMenuLabel className="mt-2 text-xs tracking-widest uppercase text-muted-foreground">
                                                        Subtitle position ({subtitlePosition}px)
                                                    </DropdownMenuLabel>
                                                    <div className="flex items-center justify-between px-2 py-1.5">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => setSubtitlePosition((s) => Math.max(20, s - 4))}>
                                                            <Minus className="h-3 w-3" />
                                                        </Button>
                                                        <span className="text-xs">{subtitlePosition}px</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => setSubtitlePosition((s) => Math.min(400, s + 4))}>
                                                            <Plus className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>

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
                                                        className="h-8 px-2 text-xs text-white hover:bg-white/10">
                                                        Audio
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        className="min-w-[180px] z-50">
                                                        <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground">
                                                            Audio track
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
                                                                `Track ${i + 1} `;
                                                            return (
                                                                <DropdownMenuItem
                                                                    key={i}
                                                                    onClick={() => setSelectedAudioIndex(i)}
                                                                    className={
                                                                        selectedAudioIndex === i
                                                                            ? "bg-accent text-accent-foreground"
                                                                            : ""
                                                                    }>
                                                                    {label}
                                                                </DropdownMenuItem>
                                                            );
                                                        })}
                                                    </DropdownMenuContent>
                                                </DropdownMenuPortal>
                                            </DropdownMenu>
                                        )}

                                        {/* Open in external player */}
                                        <DropdownMenu
                                            open={openMenu === "external"}
                                            onOpenChange={(open) =>
                                                setOpenMenu(open ? "external" : null)
                                            }>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-white hover:bg-white/10">
                                                    <ExternalLink className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    align="end"
                                                    className="min-w-[160px] z-50">
                                                    <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground">
                                                        Open in player
                                                    </DropdownMenuLabel>
                                                    <DropdownMenuItem
                                                        onClick={() => openInExternalPlayer(MediaPlayer.VLC)}>
                                                        VLC
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => openInExternalPlayer(MediaPlayer.MPV)}>
                                                        MPV
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => openInExternalPlayer(MediaPlayer.IINA)}>
                                                        IINA
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>

                                        {/* Fullscreen */}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-white hover:bg-white/10"
                                            onClick={toggleFullscreen}
                                            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
                                            {isFullscreen ? (
                                                <Minimize2 className="h-4 w-4" />
                                            ) : (
                                                <Maximize2 className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* iOS: tap-to-play overlay so playback runs in user gesture context */}
                    {ios && iosTapToPlay && (
                        <button
                            type="button"
                            onClick={handleIosTapToPlay}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-white z-10">
                            <Play className="h-16 w-16" fill="currentColor" />
                            <span className="text-sm font-medium">Tap to play</span>
                        </button>
                    )}

                    {/* iOS: if loading takes too long, stream may not support Range requests */}
                    {ios && showLoadingHint && (
                        <div className="absolute bottom-14 left-0 right-0 px-4 py-2 bg-black/80 text-white text-center text-xs z-10">
                            <p className="mb-2">Video taking too long? The stream may not work in Safari.</p>
                            <div className="flex flex-wrap justify-center gap-2">
                                <button
                                    type="button"
                                    className="underline hover:no-underline"
                                    onClick={() => openInExternalPlayer(MediaPlayer.VLC)}>
                                    Open in VLC
                                </button>
                                <span className="text-white/50">·</span>
                                <button
                                    type="button"
                                    className="underline hover:no-underline"
                                    onClick={() => openInExternalPlayer(MediaPlayer.MPV)}>
                                    Open in MPV
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div >
    );
}
