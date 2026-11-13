"use client";

import { useProfile } from "@/hooks/use-profile";
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { Play, Pause, VolumeHigh as Volume2, VolumeX, Fullscreen as Maximize2, ExitFullscreen as Minimize2, Settings, Plus, Minus, ArrowUpRightSquare as ExternalLink, AlertCircle, SkipPrev as SkipBack, SkipNext as SkipForward, Refresh as RefreshCw, Screencast as Cast, Pip as PictureInPicture2, X, ChevronRight, ArrowLeft, Layers } from "reicon-react";
import { toast } from "sonner";
import { useBingeTransition } from "@/components/player/use-binge-transition";
import { TransitionOverlay } from "@/components/player/binge-overlays";
import { DiagnosticsOverlay } from "@/components/player/diagnostics-overlay";
import {
    INITIAL_SUBTITLE_SYNC,
    videoToSubtitleTime,
    subtitleToVideoTime,
    captureSyncPoint,
    describeSync,
    type SubtitleSyncState,
} from "@/lib/utils/subtitle-sync";
import { getProxyUrl, openInPlayer, isSupportedPlayer } from "@/lib/utils";
import { decideStream, getUnsupportedCodecs, isAudioSilentlyUnsupported, isIOS, isSafari, type PlaybackEngine } from "@/lib/utils/codec-support";
import { enterNativeFullscreen, type NativeFullscreenVideo } from "@/lib/playback/native-fullscreen";
import { detectContainer, getDeviceProfile, getOriginalIssue } from "@/lib/playback/device-profile";
import { channelLabel, codecLabel, getStreamInfo, isProviderTranscodeAvailable, type StreamInfo, type StreamVariantOptions } from "@/lib/streaming/stream-info";
import { isLikelyStub, markSourceFailed } from "@/lib/streaming/source-health";
import {
    createDeviceTranscodeSession,
    DeviceTranscodeError,
    isDeviceTranscodeSupported,
    type DeviceTranscodeSession,
} from "@/lib/playback/device-transcode";

import type { AddonSubtitle } from "@/lib/addons/types";
import {
    decodeSubtitleFileBytes,
    getLanguageDisplayName,
    isSubtitleLanguage,
    normalizeSubtitleCueText,
    parseSubtitleCues,
    type SubtitleCue,
    SUBTITLE_SYMBOL_FONT_FALLBACK,
} from "@/lib/utils/subtitles";
import { useSettingsStore } from "@/lib/stores/settings";
import { useStreamingStore } from "@/lib/stores/streaming";
import { usePreviewStore } from "@/lib/stores/preview";
import type { AddonSource } from "@/lib/addons/types";
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
import { useNextEpisode } from "@/hooks/use-next-episode";
import { DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { traktClient } from "@/lib/trakt";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import { cn } from "@/lib/utils";

// Static per page load; checked once instead of on every render.
const deviceSupported = isDeviceTranscodeSupported();

/** Unified subtitle entry for the player picker. "addon" entries come from
 *  Stremio addons (have a URL to fetch and parse). "embedded" entries come
 *  from the native <video>.textTracks list (populated by the container
 *  demuxer for MP4 or by hls.js for HLS subtitle renditions) — no URL;
 *  cues are read directly off the TextTrack.cues array. */
type PlayerSubtitle = AddonSubtitle & {
    source?: "addon" | "embedded";
    trackId?: string;
};

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
};

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

function serializeProgressKey(k?: { imdbId: string; season?: number; episode?: number } | null): string {
    return k ? `${k.imdbId}:${k.season ?? ""}:${k.episode ?? ""}` : "";
}

function pickPreferredAudioTrackIndex(
    tracks: { length: number;[i: number]: AudioTrackInfo },
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
    const { getSignedProxyUrl } = await import("@/lib/signed-proxy");
    let endpoint: string;
    try {
        endpoint = await getSignedProxyUrl("resolve", downloadUrl);
    } catch {
        return null;
    }
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

const SPEED_TEST_SAMPLE_BYTES = 2 * 1024 * 1024;

async function measureStreamMbps(url: string, sampleBytes = SPEED_TEST_SAMPLE_BYTES): Promise<{ mbps: number; bytes: number }> {
    const controller = new AbortController();
    const startedAt = performance.now();
    let bytesRead = 0;
    let reachedSampleLimit = false;

    try {
        const response = await fetch(url, {
            headers: { Range: `bytes=0-${sampleBytes - 1}` },
            cache: "no-store",
            signal: controller.signal,
        });

        if (!response.ok && response.status !== 206) {
            throw new Error(`Speed probe failed (${response.status})`);
        }

        if (!response.body) {
            const buf = await response.arrayBuffer();
            bytesRead = Math.min(buf.byteLength, sampleBytes);
        } else {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytesRead += value?.byteLength ?? 0;
                if (bytesRead >= sampleBytes) {
                    reachedSampleLimit = true;
                    controller.abort();
                    break;
                }
            }
        }
    } catch (error) {
        if (!reachedSampleLimit) {
            throw error;
        }
    }

    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.05);
    return {
        mbps: (bytesRead * 8) / (elapsedSeconds * 1_000_000),
        bytes: bytesRead,
    };
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
                className="min-w-[200px] z-[100] bg-black/95 text-white border-white/10 p-1">
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

const PLAYER_BTN =
    "inline-flex items-center justify-center rounded-full text-white bg-transparent border-none cursor-pointer shrink-0 transition-[transform,background-color,box-shadow,color,opacity] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.14] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-0 active:scale-[0.93] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:opacity-35 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:shadow-none disabled:active:scale-100";
const PLAYER_BTN_SM = `${PLAYER_BTN} w-9 h-9`;
const PLAYER_BTN_MD = `${PLAYER_BTN} w-10 h-10`;
const POPUP_STYLE: React.CSSProperties = {
    background: "rgba(18, 18, 22, 0.98)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset",
};
/** Radix menu adds zoom/fade; `.player-popup` supplies its own entrance — disable the duplicate. */
const POPUP_CLS =
    "player-popup rounded-[10px] text-white data-[state=open]:animate-none data-[state=closed]:animate-none motion-reduce:!animate-none";
const POPUP_LABEL = "player-popup-label text-[10px] tracking-[0.15em] uppercase text-white/40 px-3.5 pt-2.5 pb-1.5 select-none";
const POPUP_ITEM =
    "player-popup-item relative flex items-center gap-2.5 w-full px-3.5 py-2 text-[13px] text-white/85 bg-transparent border-none cursor-pointer text-left rounded-md transition-[background,color,transform,opacity] duration-150 ease-out hover:bg-white/[0.08] hover:text-white active:scale-[0.99] motion-reduce:active:scale-100";
const POPUP_DIVIDER = "player-popup-divider h-px bg-white/[0.08] my-1";

/** Native HTML5 video player. iOS: tap-to-play (no autoplay), loading timeout hint. Windows: unchanged. */
export function LegacyVideoPreview({ file, downloadUrl, streamingLinks, subtitles, progressKey, startFromSeconds, onNext, onPrev, onPreload, onLoad, onError }: LegacyVideoPreviewProps) {
    const { activeProfile: { id: profileId } } = useProfile();
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hasPreloaded = useRef(false);
    const [error, setError] = useState(false);
    // Session-gated: only show codec warning and loading hint once per browser session
    const [showCodecWarning, setShowCodecWarning] = useState(
        () => typeof sessionStorage !== 'undefined' ? !sessionStorage.getItem('codec-warning-dismissed') : true
    );
    const [showHelp, setShowHelp] = useState(false);
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [showRemainingTime, setShowRemainingTime] = useState(false);
    const ios = isIOS();
    const [nativeFullscreen, setNativeFullscreen] = useState(false);
    const [iosTapToPlay, setIosTapToPlay] = useState(ios);
    const [showLoadingHint, setShowLoadingHint] = useState(false);
    const loadingHintDismissedRef = useRef(
        typeof sessionStorage !== 'undefined' && !!sessionStorage.getItem('loading-hint-dismissed')
    );
    const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    /** Resume time to restore after an in-player source switch so the user
     *  doesn't lose their place when picking a different stream. */
    const switchResumeTimeRef = useRef<number | null>(null);
    const [hlsAudioTracks, setHlsAudioTracks] = useState<{ name: string; lang?: string }[]>([]);
    const [audioTrackCount, setAudioTrackCount] = useState(0);
    const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);
    const [subtitleSize, setSubtitleSize] = useState(
        () => useSettingsStore.getState().settings.playback.subtitleSize
    );
    const [subtitlePosition, setSubtitlePosition] = useState(
        () => useSettingsStore.getState().settings.playback.subtitlePosition
    );
    const [syncState, setSyncState] = useState<SubtitleSyncState>(INITIAL_SUBTITLE_SYNC);
    const subtitleDelay = syncState.delayMs;
    const setSubtitleDelay = useCallback(
        (updater: number | ((prev: number) => number)) => {
            setSyncState((prev) => ({
                ...prev,
                delayMs: typeof updater === "function" ? updater(prev.delayMs) : updater,
            }));
        },
        [],
    );
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
    const [audioNormalization, setAudioNormalization] = useState(
        () => useSettingsStore.getState().settings.playback.audioNormalization
    );
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const rumbleCutFilterRef = useRef<BiquadFilterNode | null>(null);
    const presenceFilterRef = useRef<BiquadFilterNode | null>(null);
    const harshnessFilterRef = useRef<BiquadFilterNode | null>(null);
    const dryGainNodeRef = useRef<GainNode | null>(null);
    const wetGainNodeRef = useRef<GainNode | null>(null);
    const audioGraphConnectedRef = useRef(false);
    const audioSourceInitFailedRef = useRef(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSpeedProbeRunning, setIsSpeedProbeRunning] = useState(false);
    const [lastSpeedProbeMbps, setLastSpeedProbeMbps] = useState<number | null>(null);
    const speedProbeInFlightRef = useRef(false);
    const lastSpeedProbeAtRef = useRef(0);

    // User's preferred subtitle language from settings
    const preferredSubLang = useSettingsStore((s) => s.settings.playback.subtitleLanguage);
    // User's preferred audio language from streaming settings
    const preferredAudioLang = useSettingsStore((s) => s.settings.streaming.preferredLanguage);
    // IntroDB: auto-skip intro/recap/outro
    const autoSkipIntro = useSettingsStore((s) => s.settings.playback.autoSkipIntro);
    const autoNextEpisode = useSettingsStore((s) => s.settings.playback.autoNextEpisode);
    const nextEpisodePromptSeconds = useSettingsStore((s) => s.settings.playback.nextEpisodePromptSeconds);
    // TV mode — hide fullscreen button as it's redundant in TV mode where full-screen is the default
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
    const allFetchedSources = useStreamingStore((s) => s.allFetchedSources);
    const selectedSourceFromStore = useStreamingStore((s) => s.selectedSource);
    const playSourceFromStore = useStreamingStore((s) => s.playSource);
    const openSourcePicker = useStreamingStore((s) => s.openSourcePicker);
    const previewDirectTitle = usePreviewStore((s) => s.directTitle);
    const previewProgressKeyStore = usePreviewStore((s) => s.progressKey);
    const previewDirectSubs = usePreviewStore((s) => s.directSubtitles);
    const isSwitchingSource = usePreviewStore((s) => s.isSwitchingSource);
    const showInlineSourcePicker =
        allFetchedSources.length > 1 && !!(previewProgressKeyStore ?? progressKey);
    const { data: introSegments } = useIntroSegments(progressKey);
    // Track which segments have been auto-skipped (reset on new episode)
    const skippedSegmentsRef = useRef<Set<string>>(new Set());
    // Active skip-prompt segment: null | 'intro' | 'recap' | 'outro'
    const [activeSkipSegment, setActiveSkipSegment] = useState<'intro' | 'recap' | 'outro' | null>(null);
    const activeSkipSegmentRef = useRef(activeSkipSegment);
    useEffect(() => { activeSkipSegmentRef.current = activeSkipSegment; }, [activeSkipSegment]);
    // Grace-period timer: keep skip button visible 5s after exiting a segment
    const skipGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Manual subtitle rendering (bypasses Windows OS caption override)
    const [parsedCues, setParsedCues] = useState<SubtitleCue[][]>([]);
    const [activeCueText, setActiveCueText] = useState<string>("");
    /** Subtitles sourced from native <video>.textTracks — covers embedded
     *  MP4/MKV subtitle tracks AND HLS subtitle renditions (hls.js exposes
     *  them via the same textTracks list). Refreshed on track add/remove. */
    const [embeddedSubtitles, setEmbeddedSubtitles] = useState<PlayerSubtitle[]>([]);
    /** Unified list shown in the subtitle picker: addon entries from props
     *  first, then any embedded/HLS tracks discovered on the <video> element. */
    const displayedSubtitles = useMemo<PlayerSubtitle[]>(
        () => [
            ...(subtitles ?? []).map((s): PlayerSubtitle => ({ ...s, source: "addon" })),
            ...embeddedSubtitles,
        ],
        [subtitles, embeddedSubtitles],
    );

    // In-player OSD (on-screen display) for keyboard feedback
    const [osdText, setOsdText] = useState("");
    const [osdVisible, setOsdVisible] = useState(false);
    type OsdPosition = "top-right" | "center" | "left" | "right";
    const [osdPosition, setOsdPosition] = useState<OsdPosition>("top-right");
    const osdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Accumulates total seek distance while a seek key is held
    const seekAccRef = useRef<{ direction: 1 | -1; total: number } | null>(null);
    // ── Binge transition system ──
    // Local state machine for episode transitions + auto-next countdown.
    // See components/player/use-binge-transition.ts for design rationale.
    const binge = useBingeTransition();
    const { isTransitioning, autoNextCountdown, autoNextTotalDuration, guardedNav, clearTransition, cancelAutoNext, startAutoNextCountdown, isTransitioningRef } = binge;

    const onNextRef = useRef(onNext);
    onNextRef.current = onNext;
    // Seekbar hover tooltip
    const [seekHoverPct, setSeekHoverPct] = useState<number | null>(null);
    // Custom seekbar drag state
    const seekbarRef = useRef<HTMLDivElement>(null);
    const [isDraggingSeekbar, setIsDraggingSeekbar] = useState(false);
    const [seekDragPreviewTime, setSeekDragPreviewTime] = useState<number | null>(null);
    const wasPausedBeforeDragRef = useRef(false);
    // Center action icon (YouTube-style play/pause flash)
    const [centerAction, setCenterAction] = useState<"play" | "pause" | null>(null);
    const centerActionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Tracks whether the fade-out animation has completed, so the idle play button
    // doesn't mount while the flash icon is still animating out (prevents stacking).
    const [centerActionDone, setCenterActionDone] = useState(true);
    const fadeOutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Prevents the center-action-out animation from running on initial mount
    const [centerActionTriggered, setCenterActionTriggered] = useState(false);
    // Seek ripple
    const [seekRipple, setSeekRipple] = useState<{ dir: "left" | "right"; key: number } | null>(null);
    const seekRippleKeyRef = useRef(0);

    const showCenterAction = useCallback((action: "play" | "pause") => {
        if (centerActionTimeoutRef.current) clearTimeout(centerActionTimeoutRef.current);
        if (fadeOutTimeoutRef.current) clearTimeout(fadeOutTimeoutRef.current);
        setCenterAction(action);
        setCenterActionDone(false);
        setCenterActionTriggered(true);
        centerActionTimeoutRef.current = setTimeout(() => {
            setCenterAction(null);
            // Wait for the 350ms CSS fade-out animation before allowing idle play button
            fadeOutTimeoutRef.current = setTimeout(() => setCenterActionDone(true), 350);
        }, 600);
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
    const showSpeedOsd = useCallback((rate: number) => {
        showOsd(`Speed ${rate}x`, "right");
    }, [showOsd]);

    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTapRef = useRef<{ time: number; x: number } | null>(null);
    const [bufferedPercent, setBufferedPercent] = useState(0);

    // cancelAutoNext is provided by useBingeTransition above

    // Control bar auto-hide
    const [showControls, setShowControls] = useState(true);
    const [useCompactControls, setUseCompactControls] = useState(false);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Stream decision: original file vs provider's compatible (HLS) stream ──
    // With provider metadata (TorBox createstream) we know the real codecs, so
    // playable files keep full original quality and only unplayable ones are
    // transcoded — by the provider, costing neither Cloudflare nor the device.
    const configuredEngine = useSettingsStore((s) => s.settings.streaming.playbackEngine) ?? "auto";
    const [engineOverride, setEngineOverride] = useState<PlaybackEngine | null>(null);
    const engine = engineOverride ?? configuredEngine;
    /** Active provider variant after an audio/quality switch (new HLS session). */
    const [variant, setVariant] = useState<StreamInfo | null>(null);
    const baseStreamInfo = getStreamInfo(streamingLinks?.apple);
    const streamInfo = variant ?? baseStreamInfo;
    const hlsUrl = variant?.hlsUrl ?? streamingLinks?.apple;

    // New file → forget per-file overrides.
    useEffect(() => {
        setEngineOverride(null);
        setVariant(null);
    }, [downloadUrl]);

    // Why this device can't play the original (container it can't open, codecs it
    // can't decode). When set, the original is never tried — only the converted stream.
    const deviceProfile = getDeviceProfile();
    const originalIssue = deviceProfile
        ? getOriginalIssue(deviceProfile, detectContainer(selectedSourceFromStore?.fileName, file.name, downloadUrl), streamInfo)
        : null;
    const hasCodecIssue = !!originalIssue;

    const streamingSelection = useMemo(() => {
        const links = hlsUrl ? { ...streamingLinks, apple: hlsUrl } : streamingLinks;
        if (engine === "auto" && originalIssue && hlsUrl) {
            return { url: hlsUrl, isTranscoded: true, format: "HLS", reason: originalIssue };
        }
        const decision = decideStream({ downloadUrl, streamingLinks: links, fileName: file.name, info: streamInfo, engine });
        // Without metadata, hls.js browsers still prefer provider HLS so multi-audio survives.
        if (!streamInfo && engine === "auto" && hlsUrl && !isSafari() && Hls.isSupported() && decision.url !== hlsUrl) {
            return { url: hlsUrl, isTranscoded: true, format: "HLS", reason: "Compatible stream" };
        }
        return decision;
    }, [downloadUrl, streamingLinks, hlsUrl, file.name, streamInfo, engine, originalIssue]);

    // Don't start a file this device can't play while the provider's converted
    // stream may still be on its way: the failure fires fallbacks and warnings, and
    // on iOS it burns the tap. Hold the source until the lookup resolves
    // (undefined = pending, {} = none), capped so a hung lookup can't block playback.
    const [hlsWaitExpired, setHlsWaitExpired] = useState(false);
    const awaitingHls = (ios || !!originalIssue) && streamingLinks === undefined && engine !== "original" && !hlsWaitExpired;
    useEffect(() => {
        setHlsWaitExpired(false);
        const t = setTimeout(() => setHlsWaitExpired(true), 30_000);
        return () => clearTimeout(t);
    }, [downloadUrl]);

    const effectiveUrl = awaitingHls ? "" : streamingSelection.url;

    // One line per decision so device reports ("why did it play X?") are answerable from the console.
    useEffect(() => {
        if (!effectiveUrl) return;
        console.info(
            `[playback] ${deviceProfile?.label ?? "unknown device"}: ${streamingSelection.format}` +
                ` — ${streamingSelection.reason ?? "default"}${originalIssue ? ` (original: ${originalIssue})` : ""}`
        );
    }, [effectiveUrl, deviceProfile?.label, streamingSelection.format, streamingSelection.reason, originalIssue]);
    const isUsingTranscodedStream = streamingSelection.isTranscoded;

    // Track if we've tried fallback to transcoded stream
    const [triedTranscodeFallback, setTriedTranscodeFallback] = useState(false);

    // Server-side URL resolution (for addon redirect URLs)
    const triedUrlResolveRef = useRef(false);

    // ── On-device conversion (Mediabunny + FFmpeg AC-3 WASM → MSE) ──
    const [deviceSession, setDeviceSession] = useState<DeviceTranscodeSession | null>(null);
    const deviceSessionRef = useRef<DeviceTranscodeSession | null>(null);
    const deviceStartingRef = useRef(false);
    /** Provider HLS failed for this file — don't bounce back to it. */
    const hlsFailedRef = useRef(false);

    const stopDeviceSession = useCallback(() => {
        deviceSessionRef.current?.destroy();
        deviceSessionRef.current = null;
        setDeviceSession(null);
    }, []);

    useEffect(() => {
        hlsFailedRef.current = false;
        return stopDeviceSession;
    }, [downloadUrl, stopDeviceSession]);

    const finalUrl = deviceSession?.url ?? effectiveUrl;
    // Provider HLS urls don't always end in .m3u8, so trust the stream links too.
    const isHlsUrl = finalUrl.includes(".m3u8") || (!!hlsUrl && finalUrl === hlsUrl);
    const useHlsJs = isHlsUrl && !isSafari() && Hls.isSupported();
    const speedProbeUrl = useMemo(() => {
        if (isHlsUrl) return downloadUrl;
        return finalUrl;
    }, [downloadUrl, finalUrl, isHlsUrl]);

    // Suppress warning if we're using (or can fall back to) a transcoded stream
    const isHls = !!hlsUrl;
    const shouldShowWarning = hasCodecIssue && !isHls && !isUsingTranscodedStream;

    /** Switch provider audio track / resolution; keeps position via the hls.js effect. */
    const switchStreamVariant = useCallback(
        async (opts: StreamVariantOptions, label: string) => {
            if (!streamInfo) return;
            showOsd(`Switching to ${label}…`);
            const next = await streamInfo.switchVariant(opts);
            if (!next) {
                showOsd("Couldn't switch stream");
                return;
            }
            setVariant(next);
            setEngineOverride("compatible");
            showOsd(label);
        },
        [streamInfo, showOsd]
    );

    /** Start converting audio on this device. Resolves false when not possible. */
    const startDeviceConversion = useCallback(async (): Promise<boolean> => {
        const video = videoRef.current;
        if (!video || deviceSessionRef.current || deviceStartingRef.current) return !!deviceSessionRef.current;
        if (!isDeviceTranscodeSupported()) return false;
        deviceStartingRef.current = true;
        showOsd("Converting audio on this device…");
        try {
            const session = await createDeviceTranscodeSession(video, downloadUrl, {
                startAt: video.currentTime > 1 ? video.currentTime : 0,
                preferredLanguage: useSettingsStore.getState().settings.streaming.preferredLanguage,
            });
            deviceSessionRef.current = session;
            setDeviceSession(session);
            return true;
        } catch (error) {
            const reason = error instanceof DeviceTranscodeError ? error.reason : "unreachable";
            console.warn("[device-transcode]", error);
            showOsd(
                reason === "unreachable"
                    ? "This host doesn't allow on-device conversion"
                    : reason === "unsupported-audio"
                        ? "This audio format can't be converted on-device yet"
                        : "On-device conversion isn't available for this file"
            );
            return false;
        } finally {
            deviceStartingRef.current = false;
        }
    }, [downloadUrl, showOsd]);

    // Explicit "On this device" engine starts conversion right away. If the audio
    // can't be converted (DTS/TrueHD) fall back to the compatible stream, else the original.
    const hlsAvailableRef = useRef(false);
    hlsAvailableRef.current = !!hlsUrl && !hlsFailedRef.current;
    useEffect(() => {
        if (engine === "device" && !deviceSession) {
            void startDeviceConversion().then((ok) => {
                if (!ok) setEngineOverride(hlsAvailableRef.current ? "compatible" : "original");
            });
        }
        if (engine !== "device" && engine !== "auto" && deviceSession) stopDeviceSession();
    }, [engine, deviceSession, startDeviceConversion, stopDeviceSession]);

    const openInExternalPlayer = useCallback(
        (player: MediaPlayer) => {
            videoRef.current?.pause();
            openInPlayer({ url: downloadUrl, fileName: file.name, player });
            setShowCodecWarning(false);
            try { sessionStorage.setItem('codec-warning-dismissed', '1'); } catch { }
            setShowLoadingHint(false);
            try { sessionStorage.setItem('loading-hint-dismissed', '1'); } catch { }
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
    const SPEED_PROBE_COOLDOWN_MS = 45_000;
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

    const nextEpisodeCursor = useNextEpisode(progressKey?.imdbId, progressKey?.type, progressKey?.season, progressKey?.episode) ?? undefined;

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

    // Reset skipped-segment tracking whenever the episode changes.
    // Uses a serialized key instead of reference equality so new objects
    // with the same imdbId/season/episode don't trigger a false reset.
    const prevProgressKeyStrRef = useRef(serializeProgressKey(progressKey));
    useEffect(() => {
        const cur = serializeProgressKey(progressKey);
        if (prevProgressKeyStrRef.current !== cur) {
            prevProgressKeyStrRef.current = cur;

            // Stop the old media pipeline immediately to prevent dual audio
            // when switching episodes within the same player instance.
            const video = videoRef.current;
            if (video) {
                video.pause();
                video.removeAttribute('src');
                video.load();
            }

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
            watchedTimeRef.current = 0;
            watchStartRef.current = null;
            setParsedCues([]);
            setActiveCueText("");
            setActiveSubtitleIndex(-1);
            userSetSubtitleRef.current = false;
            setAudioTrackCount(0);
            setSelectedAudioIndex(0);
        }
    }, [progressKey]);

    // Stop playback immediately when a source switch starts so the old stream
    // doesn't continue while the new URL is being resolved.
    useEffect(() => {
        if (!isSwitchingSource) return;
        const video = videoRef.current;
        if (video) {
            // Preserve current position so we can resume after the switch.
            if (video.currentTime > 0) {
                switchResumeTimeRef.current = video.currentTime;
            }
            video.pause();
            video.removeAttribute("src");
            video.load();
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
            setHlsAudioTracks([]);
        }
        setIsLoading(true);
        setError(false);
        setTriedTranscodeFallback(false);
        triedUrlResolveRef.current = false;
    }, [isSwitchingSource]);

    const runBufferingSpeedProbe = useCallback(async (opts?: { auto?: boolean }) => {
        const auto = !!opts?.auto;
        if (speedProbeInFlightRef.current) return;
        if (!speedProbeUrl) return;

        const now = Date.now();
        if (auto && now - lastSpeedProbeAtRef.current < SPEED_PROBE_COOLDOWN_MS) {
            return;
        }

        speedProbeInFlightRef.current = true;
        setIsSpeedProbeRunning(true);

        try {
            let usedProxyFallback = false;
            const probe = await measureStreamMbps(speedProbeUrl).catch(async () => {
                usedProxyFallback = true;
                const { getSignedProxyUrl } = await import("@/lib/signed-proxy");
                const signed = await getSignedProxyUrl("addon", speedProbeUrl);
                return measureStreamMbps(signed);
            });

            if (probe.bytes < 128 * 1024) {
                throw new Error("Probe sample too small");
            }

            lastSpeedProbeAtRef.current = Date.now();
            setLastSpeedProbeMbps(probe.mbps);

            const mbpsText = `${probe.mbps.toFixed(1)} Mbps`;
            if (!auto) {
                showOsd(`Network ${mbpsText}`, "center");
                toast.success(usedProxyFallback ? `Measured ${mbpsText} (proxy fallback)` : `Measured ${mbpsText}`);
            }
        } catch {
            if (!auto) {
                toast.error("Could not measure stream speed for this source");
            }
        } finally {
            setIsSpeedProbeRunning(false);
            speedProbeInFlightRef.current = false;
        }
    }, [speedProbeUrl, showOsd, SPEED_PROBE_COOLDOWN_MS]);

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

    const toggleAudioNormalization = useCallback(() => {
        const next = !audioNormalization;

        setAudioNormalization(next);
        if (next && audioContextRef.current?.state === "suspended") {
            audioContextRef.current.resume().catch(() => { });
        }
        showOsd(next ? "Audio Normalization: On" : "Audio Normalization: Off");
        setSettingsPanel(null);
    }, [audioNormalization, showOsd]);

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

    const markCurrentAsCompleted = useCallback(() => {
        if (!progressKey || hasMarkedCompletedRef.current) return;
        hasMarkedCompletedRef.current = true;

        // For shows: seed the next episode so Continue Watching advances instead of disappearing.
        const nextEp = nextEpisodeCursor;

        markCompleted(nextEp);
        emitHistory("complete", true);
    }, [progressKey, markCompleted, emitHistory, nextEpisodeCursor]);

    // Original language from Trakt metadata (e.g. "en", "ja")
    const { data: originalLanguageCode } = useQuery({
        queryKey: ["trakt", profileId, "original-language", progressKey?.imdbId, progressKey?.type],
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
        if (!userSetSubtitleRef.current && displayedSubtitles.length > 0 && activeSubtitleIndex === -1 && preferredSubLang) {
            const langIndex = displayedSubtitles.findIndex((s) => isSubtitleLanguage(s, preferredSubLang));
            const bestIndex = langIndex !== -1
                ? langIndex
                : displayedSubtitles.findIndex((s) => !!s.url || s.source === "embedded");

            if (bestIndex !== -1) {
                setActiveSubtitleIndex(bestIndex);
            }
        }

        onLoad?.();
    }, [onLoad, startFromSeconds, initialProgress, displayedSubtitles, activeSubtitleIndex, preferredSubLang, applyResumePosition]);

    // Cross-device resume: if server progress arrives after the video has already loaded
    // and the user hasn't watched much yet (< 5s), apply the position now.
    useEffect(() => {
        if (initialProgress === null || !hasSeenkedToInitialRef.current) return;
        const video = videoRef.current;
        if (!video || video.currentTime >= 5) return;
        if (initialProgress > 5) applyResumePosition(initialProgress);
    }, [initialProgress, applyResumePosition]);

    // Watch for subtitles arriving later (e.g. from async fetch or embedded track load)
    useEffect(() => {
        if (!userSetSubtitleRef.current && displayedSubtitles.length && activeSubtitleIndex === -1 && !isLoading && preferredSubLang) {
            const langIndex = displayedSubtitles.findIndex((s) => isSubtitleLanguage(s, preferredSubLang));
            const bestIndex = langIndex !== -1
                ? langIndex
                : displayedSubtitles.findIndex((s) => !!s.url || s.source === "embedded");

            if (bestIndex !== -1) {
                setActiveSubtitleIndex(bestIndex);
            }
        }
    }, [displayedSubtitles, activeSubtitleIndex, isLoading, preferredSubLang]);

    // Sticky source: once a file has really played, errors are treated as
    // network hiccups and recovered on the same file (reload at position) rather
    // than silently swapping to a different release mid-movie.
    const lockSourceAfterStart = useSettingsStore((s) => s.settings.streaming.lockSourceAfterStart) ?? true;
    const playbackStartedRef = useRef(false);
    const lastGoodTimeRef = useRef(0);
    const recoveryAttemptsRef = useRef(0);
    useEffect(() => {
        playbackStartedRef.current = false;
        lastGoodTimeRef.current = 0;
        recoveryAttemptsRef.current = 0;
        const video = videoRef.current;
        if (!video) return;
        const onTime = () => {
            if (video.currentTime > 5) {
                playbackStartedRef.current = true;
                lastGoodTimeRef.current = video.currentTime;
                recoveryAttemptsRef.current = 0;
            }
        };
        video.addEventListener("timeupdate", onTime);
        return () => video.removeEventListener("timeupdate", onTime);
    }, [downloadUrl]);

    const tryRecoverSameSource = useCallback((): boolean => {
        const video = videoRef.current;
        if (!video || !lockSourceAfterStart || !playbackStartedRef.current || isHlsUrl) return false;
        const attempt = ++recoveryAttemptsRef.current;
        if (attempt > 3) return false;
        const resumeAt = lastGoodTimeRef.current;
        setIsLoading(true);
        showOsd(`Reconnecting… (${attempt}/3)`);
        setTimeout(() => {
            const onMeta = () => {
                video.currentTime = resumeAt;
                video.play().catch(() => { });
            };
            video.addEventListener("loadedmetadata", onMeta, { once: true });
            video.load();
        }, [2000, 5000, 10000][attempt - 1]);
        return true;
    }, [lockSourceAfterStart, isHlsUrl, showOsd]);

    const handleError = useCallback(() => {
        setIsLoading(false);
        if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
        }
        setShowLoadingHint(false);

        if (deviceSessionRef.current) {
            stopDeviceSession();
            if (hlsUrl && !hlsFailedRef.current) {
                showOsd("On-device conversion stopped — switching to compatible stream");
                setEngineOverride("compatible");
            } else {
                setEngineOverride("original");
                showLoadErrorToast("On-device conversion stopped. Try an external player.");
            }
            return;
        }

        if (tryRecoverSameSource()) return;
        if (lockSourceAfterStart && playbackStartedRef.current) {
            setError(true);
            showLoadErrorToast("Playback stopped and couldn't reconnect. Pick another source from the Sources menu.");
            onError?.(new Error("Playback interrupted"));
            return;
        }

        // If we haven't tried transcoded stream yet and one is available, try it
        if (!triedTranscodeFallback && streamingLinks && Object.keys(streamingLinks).length > 0 && !isUsingTranscodedStream) {
            setTriedTranscodeFallback(true);
            setIsLoading(true);

            // HLS must go through hls.js (Chrome can't play it as a plain src).
            if (hlsUrl && hlsUrl !== effectiveUrl) {
                showOsd("Switching to compatible stream");
                setEngineOverride("compatible");
                return;
            }

            // Force use of a transcoded stream
            const transcodedUrl = streamingLinks.liveMP4 || streamingLinks.h264WebM || streamingLinks.dash;
            if (transcodedUrl && transcodedUrl !== effectiveUrl) {
                showOsd("Switching to compatible stream");
                // Reset the video element with the transcoded URL
                const video = videoRef.current;
                if (video) {
                    video.src = transcodedUrl;
                    video.load();
                    video.play().catch(() => { });
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
                            video.play().catch(() => { });
                        }
                        return;
                    }
                    // Try falling back to the next best stream based on codec health
                    const streamingStore = useStreamingStore.getState();
                    if (streamingStore.playNextBestSource()) {
                        showOsd("Playback failed. Trying next source...");
                        setIsLoading(true);
                        return;
                    }

                    // Resolution didn't produce a different URL and no sources left — show error
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
    }, [onError, triedTranscodeFallback, streamingLinks, hlsUrl, isUsingTranscodedStream, effectiveUrl, hasCodecIssue, downloadUrl, showOsd, showLoadErrorToast, tryRecoverSameSource, lockSourceAfterStart, stopDeviceSession]);

    const handleLoadedMetadata = useCallback(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: AudioTrackInfo };
        }) | null;
        // Only read native audioTracks when hls.js isn't managing them
        if (!hlsRef.current && el?.audioTracks) {
            setAudioTrackCount(el.audioTracks.length);
            const chosenIndex = pickPreferredAudioTrackIndex(el.audioTracks, preferredAudioLang, originalLanguageCode);
            setSelectedAudioIndex(chosenIndex);
        }
        if (el) {
            el.defaultPlaybackRate = playbackRate;
            el.playbackRate = playbackRate;
            setDuration(el.duration || 0);
            // A ~1 minute clip for a movie/episode is a debrid "unavailable" placeholder.
            const current = useStreamingStore.getState().selectedSource;
            if (progressKey && current && isLikelyStub(el.duration)) {
                markSourceFailed(current, "stub");
                if (useStreamingStore.getState().playNextBestSource()) {
                    showOsd("That file was a placeholder — trying next source");
                    return;
                }
            }
            if (hasSeenkedToInitialRef.current) {
                // On transcode fallback/source switch, prefer the user's current
                // playback position over the initial resume point — the user may
                // have watched further since the original seek.
                const switchTarget = switchResumeTimeRef.current;
                switchResumeTimeRef.current = null;
                const seekTarget = switchTarget !== null && switchTarget > 0
                    ? switchTarget
                    : (el.currentTime > 5 ? el.currentTime : (startFromSeconds ?? initialProgress));
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
    }, [originalLanguageCode, preferredAudioLang, playbackRate, startFromSeconds, initialProgress, applyResumePosition, progressKey, showOsd]);



    // Auto-select original audio track when tracks become available (fallback for async loading)
    // Skipped when hls.js manages tracks — it handles selection in AUDIO_TRACKS_UPDATED.
    useEffect(() => {
        if (hlsRef.current) return;
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: { enabled: boolean; label?: string; language?: string } };
        }) | null;
        if (!el?.audioTracks || el.audioTracks.length <= 1 || selectedAudioIndex !== 0) return;

        const tracks = el.audioTracks;
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

        if (originalIndex !== 0) {
            setSelectedAudioIndex(originalIndex);
        }
    }, [audioTrackCount, selectedAudioIndex]);

    // Re-select audio track when Trakt original language data arrives asynchronously
    useEffect(() => {
        if (!originalLanguageCode) return;
        if (hlsRef.current) {
            // For hls.js, re-pick using the stored track info
            const hls = hlsRef.current;
            if (hls.audioTracks.length <= 1) return;
            const idx = pickPreferredAudioTrackIndex(
                Object.assign(
                    hls.audioTracks.map((t) => ({ enabled: false, label: t.name, language: t.lang })),
                    { length: hls.audioTracks.length }
                ),
                preferredAudioLang,
                originalLanguageCode,
            );
            if (idx !== selectedAudioIndex) {
                setSelectedAudioIndex(idx);
                hls.audioTrack = idx;
            }
            return;
        }
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: { enabled: boolean; label?: string; language?: string } };
        }) | null;
        if (!el?.audioTracks || el.audioTracks.length <= 1) return;
        const idx = pickPreferredAudioTrackIndex(el.audioTracks, preferredAudioLang, originalLanguageCode);
        if (idx !== selectedAudioIndex) setSelectedAudioIndex(idx);
    }, [originalLanguageCode, preferredAudioLang, selectedAudioIndex]);

    // Apply native audioTracks selection (Safari path only — hls.js handles its own switching)
    // Note: the spec requires that exactly one track is enabled at all times.
    // Setting a track to enabled=true automatically disables all others — we must
    // NOT manually disable every track first, as that can leave the element in a
    // silent/invalid state.
    useEffect(() => {
        if (hlsRef.current) return;
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number;[i: number]: { enabled: boolean } };
        }) | null;
        if (!el?.audioTracks) return;
        const tracks = el.audioTracks;
        const target = tracks[selectedAudioIndex];
        if (target) {
            target.enabled = true;
        }

        const ensureSelected = () => {
            const t = tracks[selectedAudioIndex];
            if (t && !t.enabled) {
                t.enabled = true;
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

    // hls.js: attach to the video element for HLS playback in Chrome/Firefox.
    // Exposes multiple audio tracks that native <video> cannot provide outside Safari.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !finalUrl || !useHlsJs) {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
                setHlsAudioTracks([]);
            }
            return;
        }

        // Preserve playback position when switching from direct stream to HLS
        const resumeAt = video.currentTime > 1 ? video.currentTime : 0;
        const wasPlaying = !video.paused;

        const hls = new Hls({
            enableWorker: true,
            startLevel: -1,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
            const tracks = hls.audioTracks.map((t) => ({
                name: t.name || `Track ${t.id + 1}`,
                lang: t.lang,
            }));
            setHlsAudioTracks(tracks);
            setAudioTrackCount(tracks.length);

            if (tracks.length > 1) {
                const idx = pickPreferredAudioTrackIndex(
                    Object.assign(
                        tracks.map((t) => ({ enabled: false, label: t.name, language: t.lang })),
                        { length: tracks.length }
                    ),
                    preferredAudioLang,
                    originalLanguageCode,
                );
                setSelectedAudioIndex(idx);
                hls.audioTrack = idx;
            }
        });

        // Fatal errors get a few in-place recoveries; after that fall back to the
        // original file instead of looping forever (e.g. CORS-blocked HLS host).
        let fatalCount = 0;
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            if (++fatalCount > 3) {
                hls.destroy();
                hlsRef.current = null;
                hlsFailedRef.current = true;
                if (finalUrl !== downloadUrl) {
                    showOsd("Compatible stream failed — playing original file");
                    setEngineOverride("original");
                } else {
                    handleError();
                }
                return;
            }
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
            }
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (resumeAt > 0) {
                video.currentTime = resumeAt;
            }
            if (wasPlaying || !ios) {
                video.play().catch(() => {});
            }
        });

        hls.loadSource(finalUrl);
        hls.attachMedia(video);

        return () => {
            hls.destroy();
            hlsRef.current = null;
            setHlsAudioTracks([]);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finalUrl, useHlsJs]);

    // Chrome plays files with unsupported audio (AC3/E-AC3/DTS/TrueHD) as silent
    // video without any error. Probe the decoder counters a few seconds in and
    // switch to the provider's compatible stream (or offer an external player).
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !finalUrl || isHlsUrl || deviceSession) return;
        // The provider lookup can take ~10s; deciding before it returns would try
        // on-device conversion (Dolby only) on files the provider would convert.
        // Re-runs once streamingLinks resolves.
        if (streamingLinks === undefined && isProviderTranscodeAvailable()) return;
        let startedAt: number | null = null;
        const check = () => {
            if (video.paused || video.muted || video.readyState < 3) return;
            startedAt ??= video.currentTime;
            if (video.currentTime - startedAt < 3) return;
            video.removeEventListener("timeupdate", check);
            if (isAudioSilentlyUnsupported(video) !== true) return;
            if (hlsUrl && !hlsFailedRef.current && configuredEngine !== "device") {
                showOsd("Audio format not supported here — switching to compatible stream");
                setEngineOverride("compatible");
                return;
            }
            void startDeviceConversion().then((ok) => {
                if (ok) return;
                // Nothing on this device can play this file's audio — move on to a
                // source that plays, instead of leaving silent/black video.
                if (useStreamingStore.getState().playNextBestSource()) {
                    showOsd("This file's audio can't play here — trying the next source");
                    return;
                }
                setShowCodecWarning(true);
                showLoadErrorToast("This file's audio format isn't supported by your browser. Try VLC or another external player.");
            });
        };
        video.addEventListener("timeupdate", check);
        return () => video.removeEventListener("timeupdate", check);
    }, [finalUrl, isHlsUrl, hlsUrl, streamingLinks, deviceSession, configuredEngine, showOsd, showLoadErrorToast, startDeviceConversion]);

    // hls.js: switch audio track when user selects a different one
    useEffect(() => {
        const hls = hlsRef.current;
        // Guard against the hls instance not having tracks yet (race during manifest reload)
        if (!hls || hlsAudioTracks.length <= 1) return;
        if (hls.audioTrack !== selectedAudioIndex) {
            hls.audioTrack = selectedAudioIndex;
        }
    }, [selectedAudioIndex, hlsAudioTracks.length]);

    useEffect(() => {
        if (activeSubtitleIndex < 0 || !displayedSubtitles.length) return;
        if (activeSubtitleIndex >= displayedSubtitles.length) {
            setActiveSubtitleIndex(displayedSubtitles.length - 1);
        }
    }, [activeSubtitleIndex, displayedSubtitles]);

    // Guard against stale selectedAudioIndex when switching to a video with fewer tracks
    useEffect(() => {
        if (audioTrackCount > 0 && selectedAudioIndex >= audioTrackCount) {
            setSelectedAudioIndex(0);
        }
    }, [selectedAudioIndex, audioTrackCount]);

    // Sync basic media state for custom controls.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (audioSourceInitFailedRef.current) return;

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

            // Mark completed at 85% — only if the user has genuinely watched
            // at least 30% of the total duration (guards against a simple seek-to-end).
            // onEnded always marks complete regardless of this threshold.
            const currentWatchTime = watchedTimeRef.current + (watchStartRef.current ? (Date.now() - watchStartRef.current) / 1000 : 0);
            if (progressKey && dur > 0 && time / dur > 0.85 && !hasMarkedCompletedRef.current) {
                if (currentWatchTime >= dur * COMPLETION_MIN_WATCH_FRACTION) {
                    scrobble("stop", 100);
                    markCurrentAsCompleted();
                }
            }

            // Show next-episode popup before end.
            // Priority: IntroDB outro start time > user's nextEpisodePromptSeconds setting.
            // Guarded: don't start during a transition or if already counting.
            if (
                onNextRef.current && autoNextEpisode &&
                Number.isFinite(dur) && dur > 0 &&
                !isTransitioningRef.current
            ) {
                const promptSeconds = Math.max(3, Math.min(nextEpisodePromptSeconds || 10, 15));
                const outroStart = introSegments?.outro?.start_sec;
                const outroFromEnd = outroStart != null ? dur - outroStart : Infinity;
                // Use outroStart only if it's inside the popup window
                const triggerAt = Math.min(promptSeconds, outroFromEnd);
                const remaining = dur - time;
                if (remaining > 0 && remaining <= triggerAt) {
                    const nextFn = onNextRef.current;
                    // Use promptSeconds as the countdown duration (matches user settings).
                    // The countdown ring animation runs for this full duration.
                    startAutoNextCountdown(promptSeconds, () => {
                        if (nextFn) guardedNav(() => nextFn());
                    });
                }
            }
        };
        const onWaiting = () => {
            // Suppress loading flash during episode transitions — the transition overlay
            // already provides visual feedback, and the loading bar stacks on top of it.
            if (isTransitioningRef.current) return;
            setIsLoading(true);
        };
        const onPlaying = () => {
            setIsLoading(false);
            setIsPlaying(true);
            // Clear the binge transition overlay — the new stream is now playing.
            clearTransition();
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
            if (progressKey) {
                // Trakt scrobble stop (progress >= 80% → Trakt marks as watched)
                if (!hasMarkedCompletedRef.current) {
                    scrobble("stop", 100);
                    markCurrentAsCompleted();
                }
            }
            // Auto-next: advance via guardedNav (single-flight protection).
            if (onNext && autoNextEpisode && !isTransitioningRef.current) {
                cancelAutoNext(); // clear any stale countdown
                guardedNav(() => onNext());
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
                // History flush only — progress sync is handled by useProgress hook
                // to avoid duplicate /api/progress requests that can trigger 429s.
                emitHistory("session_end", true);
            }
        };
        const onPageHide = () => {
            // History flush only — progress sync is handled by useProgress hook.
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
            const ct = video.currentTime;
            const dur = video.duration;
            const progressPct = dur > 0 ? (ct / dur) * 100 : 0;

            if (!hasMarkedCompletedRef.current) {
                // History + scrobble only — progress sync is handled by useProgress hook cleanup.
                emitHistory("stop", true);
                if (progressPct > 0) {
                    void scrobble("stop", progressPct);
                }
            }
            if (pendingSeekSyncTimerRef.current) {
                clearTimeout(pendingSeekSyncTimerRef.current);
                pendingSeekSyncTimerRef.current = null;
            }
            if (skipGraceTimerRef.current) {
                clearTimeout(skipGraceTimerRef.current);
                skipGraceTimerRef.current = null;
            }
            cancelAutoNext();
        };
    }, [progressKey, updateProgress, forceSync, markCurrentAsCompleted, onNext, onPreload, scrobble, autoSkipIntro, autoNextEpisode, nextEpisodePromptSeconds, introSegments, emitHistory, cancelAutoNext, runBufferingSpeedProbe, guardedNav, startAutoNextCountdown, clearTransition, isTransitioningRef]);

    // Stop media pipeline on unmount to prevent background audio after close.
    // Separated from the event-listener effect so it only runs on true unmount,
    // not on every dependency change which would kill the playing video.
    useEffect(() => {
        const video = videoRef.current;
        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (video) {
                video.pause();
                video.removeAttribute('src');
                video.load();
            }
            if (audioContextRef.current) {
                void audioContextRef.current.close().catch(() => { });
                audioContextRef.current = null;
            }
            audioGraphConnectedRef.current = false;
            sourceNodeRef.current = null;
            compressorNodeRef.current = null;
            gainNodeRef.current = null;
            rumbleCutFilterRef.current = null;
            presenceFilterRef.current = null;
            harshnessFilterRef.current = null;
            dryGainNodeRef.current = null;
            wetGainNodeRef.current = null;
        };
    }, []);

    // Track buffered range for seekbar visual feedback (throttled — timeupdate fires very often)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const lastSentPctRef = { current: -1 as number };
        const lastSentAtRef = { current: 0 };
        const BUFFER_UI_MIN_MS = 200;
        const BUFFER_UI_MIN_DELTA = 0.35;

        const update = () => {
            if (!video.duration) return;
            const ct = video.currentTime;
            let end = ct;
            for (let i = 0; i < video.buffered.length; i++) {
                if (video.buffered.start(i) <= ct && ct <= video.buffered.end(i)) {
                    end = video.buffered.end(i);
                    break;
                }
            }
            const pct = (end / video.duration) * 100;
            const now = performance.now();
            if (
                now - lastSentAtRef.current < BUFFER_UI_MIN_MS &&
                Math.abs(pct - lastSentPctRef.current) < BUFFER_UI_MIN_DELTA
            ) {
                return;
            }
            lastSentAtRef.current = now;
            lastSentPctRef.current = pct;
            setBufferedPercent(pct);
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
            const video = videoRef.current as NativeFullscreenVideo | null;
            setIsFullscreen(!!video?.webkitDisplayingFullscreen || (!!fsElement && (fsElement === el || fsElement === video)));
        };
        const video = videoRef.current;
        const onBegin = () => { setNativeFullscreen(true); setIsFullscreen(true); };
        const onEnd = () => { setNativeFullscreen(false); setIsFullscreen(false); };
        document.addEventListener("fullscreenchange", handler);
        video?.addEventListener("webkitbeginfullscreen", onBegin);
        video?.addEventListener("webkitendfullscreen", onEnd);
        return () => {
            document.removeEventListener("fullscreenchange", handler);
            video?.removeEventListener("webkitbeginfullscreen", onBegin);
            video?.removeEventListener("webkitendfullscreen", onEnd);
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

        if (audioContextRef.current?.state === "suspended") {
            audioContextRef.current.resume().catch(() => { });
        }

        if (el.paused || el.ended) {
            showCenterAction("play");
            void el.play().catch(() => { if (ios) setIosTapToPlay(true); });
            if (ios) enterNativeFullscreen(el);
        } else {
            showCenterAction("pause");
            el.pause();
        }
    }, [showCenterAction, ios]);

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
        setSeekHoverPct(pct);
        setSeekDragPreviewTime(pct * video.duration);
        e.currentTarget.setPointerCapture(e.pointerId);
    }, [seekbarPctFromEvent]);

    const handleSeekbarPointerMove = useCallback((e: React.PointerEvent) => {
        const bar = seekbarRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setSeekHoverPct(pct);
        if (isDraggingSeekbar) {
            const video = videoRef.current;
            if (video && Number.isFinite(video.duration) && video.duration > 0) {
                setSeekDragPreviewTime(pct * video.duration);
            }
        }
    }, [isDraggingSeekbar]);

    const handleSeekbarPointerUp = useCallback((e: React.PointerEvent) => {
        if (!isDraggingSeekbar) return;
        setIsDraggingSeekbar(false);
        const pct = seekbarPctFromEvent(e);
        const video = videoRef.current;
        if (video && Number.isFinite(video.duration) && video.duration > 0) {
            seekTo(pct * video.duration);
            setSeekDragPreviewTime(null);
            if (!wasPausedBeforeDragRef.current) {
                video.play().catch(() => { });
            }
        }
    }, [isDraggingSeekbar, seekbarPctFromEvent, seekTo]);

    const handleSeekbarPointerLeave = useCallback(() => {
        if (!isDraggingSeekbar) setSeekHoverPct(null);
    }, [isDraggingSeekbar]);

    const handleSeekbarPointerCancel = useCallback(() => {
        setIsDraggingSeekbar(false);
        setSeekDragPreviewTime(null);
        setSeekHoverPct(null);
    }, []);

    const displayedSeekbarTime = seekDragPreviewTime ?? currentTime;
    const displayedSeekbarPct = duration > 0 ? (displayedSeekbarTime / duration) * 100 : 0;

    useEffect(() => {
        return () => {
            if (!progressKey) return;
            useStreamingStore.setState((state) => {
                const current = state.currentProgressKey;
                const matchesCurrent = !!current
                    && current.imdbId === progressKey.imdbId
                    && current.type === progressKey.type
                    && current.season === progressKey.season
                    && current.episode === progressKey.episode;

                return matchesCurrent ? { currentProgressKey: null } : {};
            });
        };
    }, [progressKey]);

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

        const video = videoRef.current as NativeFullscreenVideo | null;
        if (ios && video) {
            if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
                video.webkitExitFullscreen();
                return;
            }
            if (enterNativeFullscreen(video)) return;
        }

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
    }, [fakeFullscreen, ios]);

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
                showOsd("2x Speed", "right");
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

    const [openMenu, setOpenMenu] = useState<"subtitles" | "audio" | "settings" | "streams" | "quality" | null>(null);
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

    // guardedNav is provided by useBingeTransition above.
    // It blocks all navigation while a transition is in progress and auto-clears
    // when the new stream fires its 'playing' event.

    const pickAlternateSource = useCallback(
        (src: AddonSource) => {
            const pk = previewProgressKeyStore ?? progressKey ?? undefined;
            const subPick = previewDirectSubs?.length ? previewDirectSubs : subtitles;
            void playSourceFromStore(src, previewDirectTitle || file.name, {
                progressKey: pk,
                subtitles: subPick?.length ? subPick : undefined,
            });
            setOpenMenuTracked(null);
            toast.info("Switching stream", {
                description: [src.resolution, src.quality, src.addonName].filter(Boolean).join(" · ") || "Alternative source",
                duration: 2200,
            });
        },
        [
            playSourceFromStore,
            previewDirectTitle,
            previewProgressKeyStore,
            previewDirectSubs,
            progressKey,
            subtitles,
            file.name,
            setOpenMenuTracked,
        ]
    );

    // When subtitle selection changes, toggle textTracks modes (also disables embedded tracks).
    // Discover native textTracks whenever the video element gains/loses them
    // (fires on loadedmetadata, on HLS subtitle rendition switches, etc.).
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const sync = () => {
            const found: PlayerSubtitle[] = [];
            for (const t of Array.from(video.textTracks)) {
                if (t.id === "debridui-native-subtitles") continue;
                if (t.kind !== "subtitles" && t.kind !== "captions") continue;
                const lang = (t.language || "").toLowerCase();
                const label = t.label || "";
                const trackId = t.id && t.id.length > 0
                    ? t.id
                    : `${label}-${lang}-${found.length}`;
                found.push({
                    lang: lang || "und",
                    name: label || getLanguageDisplayName(lang) || "Embedded",
                    source: "embedded",
                    trackId,
                    url: undefined as unknown as string,
                });
            }
            setEmbeddedSubtitles((prev) => {
                // Skip state update when nothing changed to avoid re-renders on every HLS fragment tick.
                if (prev.length === found.length && prev.every((p, i) => p.trackId === found[i]?.trackId)) {
                    return prev;
                }
                return found;
            });
        };

        sync();
        const tracks = video.textTracks;
        tracks.addEventListener?.("addtrack", sync);
        tracks.addEventListener?.("removetrack", sync);
        video.addEventListener("loadedmetadata", sync);
        return () => {
            tracks.removeEventListener?.("addtrack", sync);
            tracks.removeEventListener?.("removetrack", sync);
            video.removeEventListener("loadedmetadata", sync);
        };
    }, []);

    // Manage textTrack.mode based on what the user picked.
    // • Embedded entry selected → its track = 'hidden' (fires cuechange
    //   without rendering the browser's native caption overlay).
    // • Anything else selected → all tracks disabled so the browser stays silent.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const entry = displayedSubtitles[activeSubtitleIndex];
        video.dataset.activeSubtitle = String(activeSubtitleIndex);

        for (const track of Array.from(video.textTracks)) {
            if (track.id === "debridui-native-subtitles") continue;
            if (track.kind !== "subtitles" && track.kind !== "captions") continue;
            const isSelected = entry?.source === "embedded" && entry.trackId && (
                track.id === entry.trackId ||
                track.label === entry.name
            );
            track.mode = isSelected ? "hidden" : "disabled";
        }
    }, [activeSubtitleIndex, displayedSubtitles]);

    // When an embedded entry is active, snapshot its cues into parsedCues
    // so the custom overlay + sync transform work uniformly across sources.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const entry = displayedSubtitles[activeSubtitleIndex];
        if (!entry || entry.source !== "embedded" || !entry.trackId) return;
        const track = Array.from(video.textTracks).find(
            (t) =>
                (t.kind === "subtitles" || t.kind === "captions") &&
                (t.id === entry.trackId || t.label === entry.name)
        );
        if (!track) return;

        const snapshot = () => {
            if (!track.cues) return;
            const cues: SubtitleCue[] = [];
            for (let i = 0; i < track.cues.length; i++) {
                const c = track.cues[i] as VTTCue;
                cues.push({
                    start: c.startTime,
                    end: c.endTime,
                    text: normalizeSubtitleCueText(c.text || ""),
                });
            }
            setParsedCues((prev) => {
                const next = [...prev];
                next[activeSubtitleIndex] = cues;
                return next;
            });
        };
        snapshot();
        track.addEventListener("cuechange", snapshot);
        return () => track.removeEventListener("cuechange", snapshot);
    }, [activeSubtitleIndex, displayedSubtitles]);

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
                if (!loadingHintDismissedRef.current) {
                    setShowLoadingHint(true);
                    loadingHintDismissedRef.current = true;
                    if (typeof window !== "undefined") {
                        sessionStorage.setItem("debridui-loading-hint-dismissed", "true");
                    }
                }
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
        const video = videoRef.current;
        if (!video) return;
        void video.play().catch(() => setIosTapToPlay(true));
        enterNativeFullscreen(video);
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

            const keepsDesktopChromeHidden = !useCompactControls && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "J", "l", "L", "m", "M", ",", "<", ".", ">", "[", "]", "AudioVolumeUp", "AudioVolumeDown", "AudioVolumeMute"].includes(event.key);
            if (!keepsDesktopChromeHidden) {
                resetControlsTimeout();
            }

            switch (event.key) {
                case "Escape":
                    if (showHelp) {
                        event.preventDefault();
                        setShowHelp(false);
                        break;
                    }
                    if (autoNextCountdown !== null) {
                        event.preventDefault();
                        cancelAutoNext();
                        break;
                    }
                    if (fakeFullscreen) {
                        event.preventDefault();
                        setFakeFullscreen(false);
                        setIsFullscreen(false);
                    }
                    break;
                case "Tab":
                    // Quick-action: click the visible skip/next button
                    if (autoNextCountdown !== null && onNext) {
                        event.preventDefault();
                        markCurrentAsCompleted();
                        cancelAutoNext();
                        guardedNav(() => onNext());
                    } else if (activeSkipSegment && !autoSkipIntro) {
                        event.preventDefault();
                        const seg = introSegments?.[activeSkipSegment];
                        if (seg && videoRef.current) {
                            skippedSegmentsRef.current.add(activeSkipSegment);
                            videoRef.current.currentTime = seg.end_sec;
                            setActiveSkipSegment(null);
                        }
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
                        showSpeedOsd(next);
                        return next;
                    });
                    break;
                case "]":
                    event.preventDefault();
                    setPlaybackRate((prev) => {
                        const next = Math.min(4, +(prev + 0.25).toFixed(2));
                        showSpeedOsd(next);
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
                        if (autoNextCountdown !== null) markCurrentAsCompleted();
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
                            videoRef.current?.requestPictureInPicture().catch(() => { });
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
                    if (!displayedSubtitles.length) return;
                    event.preventDefault();
                    setActiveSubtitleIndex((prev) => {
                        if (displayedSubtitles.length === 0) return -1;
                        if (prev === -1) {
                            showOsd(`Subtitles: ${displayedSubtitles[0].name || "Track 1"}`);
                            return 0;
                        }
                        const next = prev + 1;
                        if (next < displayedSubtitles.length) {
                            showOsd(`Subtitles: ${displayedSubtitles[next].name || `Track ${next + 1}`}`);
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
                case "s":
                case "S":
                    if (activeSkipSegment && !autoSkipIntro) {
                        event.preventDefault();
                        const seg = introSegments?.[activeSkipSegment];
                        if (seg && videoRef.current) {
                            skippedSegmentsRef.current.add(activeSkipSegment);
                            videoRef.current.currentTime = seg.end_sec;
                            setActiveSkipSegment(null);
                            showOsd(
                                activeSkipSegment === "intro" ? "Skipped Intro" :
                                    activeSkipSegment === "recap" ? "Skipped Recap" : "Skipped Credits",
                            );
                        }
                    }
                    break;
                case "d":
                case "D":
                    event.preventDefault();
                    setShowDiagnostics((v) => {
                        showOsd(v ? "Diagnostics Off" : "Diagnostics On");
                        return !v;
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
    }, [subtitles, togglePlay, toggleMute, toggleFullscreen, seekTo, showOsd, showSpeedOsd, triggerSeekRipple, fakeFullscreen, isFullscreen, autoNextCountdown, cancelAutoNext, onPrev, onNext, resetControlsTimeout, showHelp, activeSkipSegment, autoSkipIntro, introSegments, guardedNav, useCompactControls, markCurrentAsCompleted, setSubtitleDelay, displayedSubtitles]);

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

    // Gamepad / external seek + volume with OSD feedback
    useEffect(() => {
        const seekHandler = (e: Event) => {
            const delta = (e as CustomEvent<{ delta: number }>).detail?.delta;
            if (typeof delta !== "number") return;
            const cur = videoRef.current?.currentTime ?? 0;
            seekTo(cur + delta);
            triggerSeekRipple(delta < 0 ? "left" : "right");
            const dir: 1 | -1 = delta > 0 ? 1 : -1;
            if (seekAccRef.current?.direction === dir) { seekAccRef.current.total += Math.abs(delta); }
            else { seekAccRef.current = { direction: dir, total: Math.abs(delta) }; }
            showOsd(delta < 0 ? `« ${seekAccRef.current.total}s` : `» ${seekAccRef.current.total}s`, delta < 0 ? "left" : "right");
        };
        const volHandler = (e: Event) => {
            const delta = (e as CustomEvent<{ delta: number }>).detail?.delta;
            if (typeof delta !== "number") return;
            const video = videoRef.current;
            if (!video) return;
            const newVol = Math.max(0, Math.min(1, video.volume + delta));
            video.volume = newVol;
            video.muted = newVol === 0;
            setVolume(newVol);
            setIsMuted(newVol === 0);
            showOsd(newVol === 0 ? "Muted" : `Volume ${Math.round(newVol * 100)}%`, "center");
        };
        window.addEventListener("debridui-player-seek", seekHandler);
        window.addEventListener("debridui-player-volume", volHandler);
        return () => {
            window.removeEventListener("debridui-player-seek", seekHandler);
            window.removeEventListener("debridui-player-volume", volHandler);
        };
    }, [seekTo, showOsd, resetControlsTimeout, triggerSeekRipple]);

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
            audioNormalization,
        });
    }, [subtitleSize, subtitlePosition, playbackRate, subtitleBackground, subtitleColor, subtitleFont, audioNormalization]);
    // Apply loop flag to the video element
    useEffect(() => {
        if (videoRef.current) videoRef.current.loop = loop;
    }, [loop]);

    // Audio Normalization Pipeline (Web Audio API)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (audioSourceInitFailedRef.current) return;

        const rampGain = (node: GainNode | null, value: number, context: AudioContext, duration = 0.12) => {
            if (!node) return;
            const now = context.currentTime;
            node.gain.cancelScheduledValues(now);
            node.gain.setValueAtTime(node.gain.value, now);
            node.gain.linearRampToValueAtTime(value, now + duration);
        };

        // Initialize AudioContext on first need if enabled
        if (audioNormalization && !audioContextRef.current) {
            const AudioContextClass = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
            if (AudioContextClass) {
                audioContextRef.current = new AudioContextClass();
            }
        }

        const ctx = audioContextRef.current;
        if (!ctx) return;

        // Source node is tied to the element, create only once
        if (!sourceNodeRef.current) {
            try {
                sourceNodeRef.current = ctx.createMediaElementSource(video);
            } catch (e) {
                // If source creation fails, keep native media audio path untouched.
                audioSourceInitFailedRef.current = true;
                if (audioNormalization) {
                    setAudioNormalization(false);
                    showOsd("Audio normalization unavailable");
                    toast.error("Audio normalization unavailable for this stream");
                }
                console.error("[legacy-player] Failed to create audio source node:", e);
                return;
            }
        }

        const source = sourceNodeRef.current;

        // Lazy create effect nodes
        if (!compressorNodeRef.current) {
            const comp = ctx.createDynamicsCompressor();
            /**
             * Normalization / Night Mode settings:
             * - Gentle, dialogue-first dynamic control for night listening
             * - Softer ratio/attack than a loudness maximizer to avoid sharp transients
             */
            comp.threshold.setValueAtTime(-26, ctx.currentTime);
            comp.knee.setValueAtTime(36, ctx.currentTime);
            comp.ratio.setValueAtTime(4.5, ctx.currentTime);
            comp.attack.setValueAtTime(0.02, ctx.currentTime);
            comp.release.setValueAtTime(0.3, ctx.currentTime);
            compressorNodeRef.current = comp;
        }

        if (!gainNodeRef.current) {
            const gain = ctx.createGain();
            // Keep makeup gain conservative to avoid "clarity boost" harshness.
            gain.gain.setValueAtTime(1.15, ctx.currentTime);
            gainNodeRef.current = gain;
        }

        if (!rumbleCutFilterRef.current) {
            const filter = ctx.createBiquadFilter();
            filter.type = "highpass";
            filter.frequency.setValueAtTime(70, ctx.currentTime);
            filter.Q.setValueAtTime(0.707, ctx.currentTime);
            rumbleCutFilterRef.current = filter;
        }

        if (!presenceFilterRef.current) {
            const filter = ctx.createBiquadFilter();
            filter.type = "peaking";
            filter.frequency.setValueAtTime(1800, ctx.currentTime);
            filter.Q.setValueAtTime(0.8, ctx.currentTime);
            filter.gain.setValueAtTime(1.2, ctx.currentTime);
            presenceFilterRef.current = filter;
        }

        if (!harshnessFilterRef.current) {
            const filter = ctx.createBiquadFilter();
            filter.type = "highshelf";
            filter.frequency.setValueAtTime(4200, ctx.currentTime);
            filter.gain.setValueAtTime(-2.4, ctx.currentTime);
            harshnessFilterRef.current = filter;
        }

        if (!dryGainNodeRef.current) {
            const dry = ctx.createGain();
            dry.gain.setValueAtTime(audioNormalization ? 0 : 1, ctx.currentTime);
            dryGainNodeRef.current = dry;
        }

        if (!wetGainNodeRef.current) {
            const wet = ctx.createGain();
            wet.gain.setValueAtTime(audioNormalization ? 1 : 0, ctx.currentTime);
            wetGainNodeRef.current = wet;
        }

        if (!audioGraphConnectedRef.current) {
            source.connect(dryGainNodeRef.current);
            dryGainNodeRef.current.connect(ctx.destination);

            source.connect(rumbleCutFilterRef.current);
            rumbleCutFilterRef.current.connect(presenceFilterRef.current);
            presenceFilterRef.current.connect(harshnessFilterRef.current);
            harshnessFilterRef.current.connect(compressorNodeRef.current);
            compressorNodeRef.current.connect(gainNodeRef.current);
            gainNodeRef.current.connect(wetGainNodeRef.current);
            wetGainNodeRef.current.connect(ctx.destination);

            audioGraphConnectedRef.current = true;
        }

        rampGain(dryGainNodeRef.current, audioNormalization ? 0 : 1, ctx);
        rampGain(wetGainNodeRef.current, audioNormalization ? 1 : 0, ctx);

        // Ensure context is running if we're already playing
        if (isPlaying && ctx.state === "suspended") {
            ctx.resume().catch(() => { });
        }
    }, [audioNormalization, isPlaying, showOsd]);

    // Warm the subtitle proxy in the background, but never block first frame on it.
    useEffect(() => {
        const first = subtitles?.[0];
        if (!first?.url) return;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const run = async () => {
            try {
                const res = await fetch(getProxyUrl(first.url), { signal: controller.signal });
                if (res.ok) {
                    // drain a small bit so the request fully completes in some environments
                    await res.text();
                }
            } catch {
                // Subtitle warm-up is best-effort only.
            } finally {
                clearTimeout(timeoutId);
            }
        };

        void run();
        return () => {
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

        const controller = new AbortController();




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
                return decodeSubtitleFileBytes(buf);
            } catch {
                return null;
            } finally {
                clearTimeout(timeoutId);
                controller.signal.removeEventListener("abort", onAbort);
            }
        };


        const run = async () => {
            setParsedCues(subtitles.map(() => []));
            const prioritizedIndex = activeSubtitleIndex >= 0
                ? activeSubtitleIndex
                : (() => {
                    const preferredIndex = preferredSubLang
                        ? subtitles.findIndex((sub) => isSubtitleLanguage(sub, preferredSubLang))
                        : -1;
                    return preferredIndex !== -1 ? preferredIndex : subtitles.findIndex((sub) => !!sub.url);
                })();

            const allCues: SubtitleCue[][] = subtitles.map(() => []);

            if (prioritizedIndex >= 0 && subtitles[prioritizedIndex]?.url) {
                const prioritizedText = await fetchSubtitleText(subtitles[prioritizedIndex]!.url);
                if (controller.signal.aborted) return;
                if (prioritizedText) {
                    allCues[prioritizedIndex] = parseSubtitleCues(prioritizedText);
                    setParsedCues([...allCues]);
                }
            }

            const remaining = await Promise.all(
                subtitles.map(async (sub, index) => {
                    if (index === prioritizedIndex) return allCues[index];
                    if (!sub.url) return [];

                    const txt = await fetchSubtitleText(sub.url);
                    return txt ? parseSubtitleCues(txt) : [];
                })
            );

            if (!controller.signal.aborted) {
                setParsedCues(remaining);
            }
        };

        void run();
        return () => controller.abort();
    }, [subtitles, activeSubtitleIndex, preferredSubLang]);

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
        const adjustedTime = videoToSubtitleTime(currentTime, syncState);
        const activeCue = cues.find((c) => adjustedTime >= c.start && adjustedTime < c.end);
        setActiveCueText(activeCue?.text ?? "");
    }, [activeSubtitleIndex, parsedCues, currentTime, syncState]);

    // Native fullscreen can't display our HTML subtitle overlay.
    useEffect(() => {
        const video = videoRef.current;
        const cues = parsedCues[activeSubtitleIndex];
        if (!ios || !video || !cues?.length) return;
        const element = document.createElement("track");
        element.id = "debridui-native-subtitles";
        element.kind = "subtitles";
        element.label = displayedSubtitles[activeSubtitleIndex]?.name || "Selected subtitles";
        element.srclang = displayedSubtitles[activeSubtitleIndex]?.lang || "und";
        video.appendChild(element);
        const track = element.track;
        track.mode = "hidden";
        for (const cue of cues) {
            const start = subtitleToVideoTime(cue.start, syncState);
            const end = subtitleToVideoTime(cue.end, syncState);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= Math.max(0, start)) continue;
            track.addCue(new VTTCue(Math.max(0, start), end, cue.text));
        }
        track.mode = nativeFullscreen ? "showing" : "hidden";
        return () => {
            track.mode = "disabled";
            element.remove();
        };
    }, [ios, parsedCues, activeSubtitleIndex, displayedSubtitles, syncState, nativeFullscreen]);

    // iPhone opens Apple's player on play when inline playback isn't requested.
    useEffect(() => {
        const el = videoRef.current;
        if (el && !ios) el.setAttribute("webkit-playsinline", "true");
    }, [ios]);

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

    const isVolumeOsd = /^(Volume \d+%|Muted|Unmuted)$/.test(osdText);
    const hasVolumeBar = /^Volume \d+%$/.test(osdText);
    const isSeekOsd = /^[«»]\s\d+s$/.test(osdText);

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
                                    videoRef.current.play().catch(() => { });
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
                        src={useHlsJs || !finalUrl ? undefined : finalUrl}
                        autoPlay={!iosTapToPlay && !!finalUrl}
                        playsInline={!ios}
                        preload="metadata"
                        crossOrigin={isHls || isUsingTranscodedStream || !!finalUrl ? "anonymous" : undefined}
                        className="w-full h-full object-contain bg-black transition-opacity duration-500 ease-premium data-[loading=true]:opacity-[0.88] motion-reduce:transition-none"
                        data-loading={isLoading && !error ? "true" : undefined}
                        style={{ maxHeight: "100%" }}
                        onLoadedMetadata={handleLoadedMetadata}
                        onLoadedData={handleLoad}
                        onError={useHlsJs ? undefined : handleError}
                    />

                    <DiagnosticsOverlay
                        open={showDiagnostics}
                        videoRef={videoRef}
                        sourceUrl={selectedSourceFromStore?.url ?? finalUrl ?? null}
                        sourceLabel={selectedSourceFromStore?.addonName ?? null}
                    />

                    {/* YouTube-style top loading bar */}
                    {(isLoading && !error && !isTransitioning && !isSwitchingSource) && (
                        <div className="player-loading-bar absolute top-0 left-0 right-0 h-[3px] z-50 overflow-hidden" />
                    )}

                    {/* YouTube-style center action icon (flash on play/pause) */}
                    {centerActionTriggered && (
                        <div className="player-center-action">
                            <div
                                className="player-center-action-icon"
                                data-visible={centerAction !== null ? "true" : "false"}
                            >
                                {centerAction === "play" ? (
                                    <Play weight="Filled" className="h-8 w-8 ml-0.5" />
                                ) : (
                                    <Pause weight="Filled" className="h-8 w-8" />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Big center play button when paused (idle state — hidden on mobile where compact controls have their own) */}
                    {!isLoading && !isPlaying && centerActionDone && !useCompactControls && !isTransitioning && (
                        <div className="player-center-action">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlay();
                                }}
                                className="player-center-big-play"
                                aria-label="Play"
                            >
                                <Play weight="Filled" className="relative z-[1] h-9 w-9 ml-1 drop-shadow-md" />
                            </button>
                        </div>
                    )}

                    {/* Mobile center controls: skip ±10s + play/pause */}
                    {useCompactControls && showControls && !isLoading && !isTransitioning && (
                        <div className="absolute inset-0 z-30 flex items-center justify-center gap-10 pointer-events-none" data-player-controls>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); seekTo((videoRef.current?.currentTime ?? 0) - 10); }}
                                className="player-mobile-chrome-btn pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-white/90"
                            >
                                <SkipBack className="size-5" />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                                className="player-mobile-chrome-btn player-mobile-chrome-btn--main pointer-events-auto flex h-[52px] w-[52px] items-center justify-center rounded-full text-white"
                            >
                                {isPlaying ? <Pause className="size-6" /> : <Play weight="Filled" className="size-6 ml-0.5" />}
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); seekTo((videoRef.current?.currentTime ?? 0) + 10); }}
                                className="player-mobile-chrome-btn pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-white/90"
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
                        style={{
                            transitionDuration: osdVisible ? "180ms" : "320ms",
                            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                    >
                        <div
                            className={cn(
                                "player-osd-inner rounded-lg text-center text-white",
                                isVolumeOsd
                                    ? "min-w-[100px] px-5 py-2.5 text-sm font-semibold"
                                    : isSeekOsd
                                        ? "w-[84px] px-3.5 py-1.5 text-xs font-medium tabular-nums"
                                        : "min-w-[90px] px-3.5 py-1.5 text-xs font-medium"
                            )}
                            style={{ background: "rgba(0,0,0,0.92)", letterSpacing: "0.03em" }}>
                            {osdText}
                            {hasVolumeBar && (
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
                            className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
                            onClick={() => setShowHelp(false)}>
                            <div
                                className="rounded-lg border border-white/12 bg-black/95 p-6 mx-4 max-w-lg w-full shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300 motion-safe:ease-premium motion-reduce:animate-none"
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
                        onClose={() => { setShowCodecWarning(false); try { sessionStorage.setItem('codec-warning-dismissed', '1'); } catch { } }}
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
                                    fontFamily:
                                        subtitleFont === "mono"
                                            ? `ui-monospace, monospace, ${SUBTITLE_SYMBOL_FONT_FALLBACK}`
                                            : subtitleFont === "serif"
                                              ? `ui-serif, Georgia, "Times New Roman", serif, ${SUBTITLE_SYMBOL_FONT_FALLBACK}`
                                              : subtitleFont === "trebuchet"
                                                ? `"Trebuchet MS", "Segoe UI", sans-serif, ${SUBTITLE_SYMBOL_FONT_FALLBACK}`
                                                : `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, ${SUBTITLE_SYMBOL_FONT_FALLBACK}`,
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
                            "player-top-chrome absolute inset-x-0 top-0 z-40 pointer-events-none transition-[opacity,transform] duration-[420ms] ease-premium motion-reduce:duration-150 motion-reduce:transition-opacity",
                            showControls && !isTransitioning ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"
                        )}
                    >
                        <div data-player-controls className="player-top-chrome-inner pointer-events-auto px-4 pb-12 pt-4">
                            <p className="truncate text-sm font-medium tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]">
                                {file.name}
                            </p>
                        </div>
                    </div>

                    {/* Transition overlay: shown during episode switches.
                        Rendered INSIDE the player container so it remains visible
                        during native fullscreen (elements outside the fullscreen
                        element are hidden by the browser). */}
                    <TransitionOverlay isVisible={isTransitioning} />

                    {/* Source-switch loading overlay: shown when switching streams via the picker.
                        Uses the same visual language as TransitionOverlay so it feels consistent. */}
                    {isSwitchingSource && (
                        <div className="absolute inset-0 z-[55] pointer-events-auto flex items-center justify-center bg-black/70">
                            <div className="player-transition-dots">
                                <span className="player-transition-dot" style={{ animationDelay: "0ms" }} />
                                <span className="player-transition-dot" style={{ animationDelay: "160ms" }} />
                                <span className="player-transition-dot" style={{ animationDelay: "320ms" }} />
                            </div>
                        </div>
                    )}

                    {/* Floating CTA stack: keep skip/next prompts in one place to avoid overlap */}
                    {!isTransitioning && (autoNextCountdown !== null || (activeSkipSegment && !autoSkipIntro)) && (
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
                                        style={{ background: "rgba(0,0,0,0.95)", maxWidth: 320 }}
                                    >
                                        <div className="px-4 pt-3 pb-1">
                                            <p className="text-[11px] uppercase tracking-wider text-white/40 font-medium">Up Next</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { markCurrentAsCompleted(); cancelAutoNext(); if (onNext) guardedNav(() => onNext()); }}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-[background,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.05] active:scale-[0.98]"
                                        >
                                            <svg width="28" height="28" viewBox="0 0 40 40" className="shrink-0 -rotate-90">
                                                <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                                                <circle
                                                    cx="20" cy="20" r="18" fill="none" stroke="var(--primary)" strokeWidth="2.5"
                                                    strokeDasharray="113" className="player-countdown-ring"
                                                    style={{ "--countdown-duration": `${autoNextTotalDuration}s` } as React.CSSProperties}
                                                />
                                            </svg>
                                            <div className="flex-1 text-left min-w-0">
                                                <p className="text-sm font-medium text-white truncate">Next Episode</p>
                                                <p className="text-[11px] text-white/40 tabular-nums">{autoNextCountdown}s</p>
                                            </div>
                                            <SkipForward className="size-4 text-white/60 shrink-0" />
                                        </button>
                                    </div>
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
                                        style={{ background: "rgba(0,0,0,0.92)" }}
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
                                        className="flex items-center justify-center rounded-md bg-black/85 p-2 text-white/50 transition-all hover:bg-white/10 hover:text-white active:scale-90"
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
                            "absolute inset-x-0 bottom-0 z-40 pointer-events-none transition-[opacity,transform] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-150 motion-reduce:transition-opacity",
                            showControls && !isTransitioning ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
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
                                aria-valuenow={Math.round(displayedSeekbarTime)}
                                aria-valuemin={0}
                                aria-valuemax={Math.round(duration)}
                                tabIndex={0}
                                data-dragging={isDraggingSeekbar ? "true" : "false"}
                                onPointerDown={handleSeekbarPointerDown}
                                onPointerMove={handleSeekbarPointerMove}
                                onPointerUp={handleSeekbarPointerUp}
                                onPointerCancel={handleSeekbarPointerCancel}
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
                                            width: `${displayedSeekbarPct}%`,
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
                                        left: `${displayedSeekbarPct}%`
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
                                        {formatTime(isDraggingSeekbar && seekDragPreviewTime !== null ? seekDragPreviewTime : seekHoverPct * duration)}
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
                                        data-tv-focusable
                                    >
                                        {isPlaying ? (
                                            <Pause weight="Filled" className="h-5 w-5" />
                                        ) : (
                                            <Play weight="Filled" className="h-5 w-5 ml-0.5" />
                                        )}
                                    </button>

                                    <button
                                        className={PLAYER_BTN_SM}
                                        onClick={(e) => { e.stopPropagation(); if (onPrev) guardedNav(() => onPrev()); }}
                                        disabled={!onPrev || isTransitioning}
                                        title="Previous episode"
                                        data-tv-focusable
                                    >
                                        <SkipBack weight="Filled" className="h-4 w-4" />
                                    </button>
                                    <button
                                        className={PLAYER_BTN_SM}
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            if (autoNextCountdown !== null) markCurrentAsCompleted();
                                            if (onNext) guardedNav(() => onNext()); 
                                        }}
                                        disabled={!onNext || isTransitioning}
                                        title="Next episode"
                                        data-tv-focusable
                                    >
                                        <SkipForward weight="Filled" className="h-4 w-4" />
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
                                            data-tv-focusable
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
                                            {playbackRate}x
                                        </span>
                                    )}
                                </div>

                                {/* Right: Audio, CC, Settings, Cast, Fullscreen */}
                                <div className="ml-auto flex items-center gap-1">
                                    {/* On-device conversion: pick which original audio track to convert */}
                                    {deviceSession && deviceSession.audioTracks.length > 1 && (
                                        <DropdownMenu
                                            open={openMenu === "audio"}
                                            onOpenChange={(open) => setOpenMenuTracked(open ? "audio" : null)}
                                        >
                                            <DropdownMenuTrigger asChild>
                                                <button type="button" className={cn(PLAYER_BTN_SM, "text-[11px] font-medium tracking-wide")} data-tv-focusable>
                                                    Audio
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    collisionBoundary={containerRef.current ?? undefined}
                                                    collisionPadding={8}
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[240px] z-50 p-1")}
                                                    style={POPUP_STYLE}
                                                >
                                                    <div className={POPUP_LABEL}>Audio Tracks</div>
                                                    {deviceSession.audioTracks.map((track) => (
                                                        <button
                                                            key={track.index}
                                                            onClick={() => {
                                                                setOpenMenuTracked(null);
                                                                showOsd(`Audio: ${track.label}`);
                                                                void deviceSession.switchAudio(track.index);
                                                            }}
                                                            className={cn(POPUP_ITEM, "flex items-center justify-between gap-3")}
                                                            data-active={deviceSession.activeAudioIndex === track.index}
                                                        >
                                                            <span className="truncate">{track.label}</span>
                                                            <span className="shrink-0 text-[10px] text-white/45">
                                                                {[codecLabel(track.codec), channelLabel(track.channels)].filter(Boolean).join(" ")}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {/* Provider stream controls (TorBox): real audio tracks with codecs + quality */}
                                    {!deviceSession && streamInfo && streamInfo.audios.length > 1 && (
                                        <DropdownMenu
                                            open={openMenu === "audio"}
                                            onOpenChange={(open) => setOpenMenuTracked(open ? "audio" : null)}
                                        >
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        PLAYER_BTN_SM,
                                                        "text-[11px] font-medium tracking-wide",
                                                        openMenu === "audio" && "bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.12)] text-white"
                                                    )}
                                                    data-tv-focusable
                                                >
                                                    Audio
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    collisionBoundary={containerRef.current ?? undefined}
                                                    collisionPadding={8}
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[240px] z-50 p-1")}
                                                    style={POPUP_STYLE}
                                                >
                                                    <div className={POPUP_LABEL}>Audio Tracks</div>
                                                    {streamInfo.audios.map((track) => {
                                                        const active = isUsingTranscodedStream
                                                            ? streamInfo.audioIndex === track.index
                                                            : (track.isDefault ?? track.index === 0);
                                                        const name = [track.language ? getLanguageDisplayName(track.language) : "", track.title?.trim()]
                                                            .filter(Boolean).join(" · ") || `Track ${track.index + 1}`;
                                                        const unsupported = getUnsupportedCodecs({ ...streamInfo, videoCodec: undefined }, track.index).length > 0;
                                                        return (
                                                            <button
                                                                key={track.index}
                                                                onClick={() => {
                                                                    setOpenMenuTracked(null);
                                                                    if (!active) void switchStreamVariant({ audioIndex: track.index }, `Audio: ${name}`);
                                                                }}
                                                                className={cn(POPUP_ITEM, "flex items-center justify-between gap-3")}
                                                                data-active={active}
                                                            >
                                                                <span className="truncate">{name}</span>
                                                                <span className={cn("shrink-0 text-[10px] tabular-nums", unsupported ? "text-amber-300/80" : "text-white/45")}>
                                                                    {[codecLabel(track.codec), channelLabel(track.channels)].filter(Boolean).join(" ")}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {(streamInfo || deviceSupported) && (
                                        <DropdownMenu
                                            open={openMenu === "quality"}
                                            onOpenChange={(open) => setOpenMenuTracked(open ? "quality" : null)}
                                        >
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        PLAYER_BTN_SM,
                                                        "text-[11px] font-medium tracking-wide",
                                                        openMenu === "quality" && "bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.12)] text-white"
                                                    )}
                                                    title={streamingSelection.reason}
                                                    data-tv-focusable
                                                >
                                                    {deviceSession ? "Device" : isUsingTranscodedStream ? "Compat" : "Original"}
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    collisionBoundary={containerRef.current ?? undefined}
                                                    collisionPadding={8}
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[240px] z-50 p-1")}
                                                    style={POPUP_STYLE}
                                                >
                                                    <div className={POPUP_LABEL}>Stream</div>
                                                    {streamingSelection.reason && (
                                                        <p className="px-2 pb-1.5 text-[11px] leading-snug text-white/50">{streamingSelection.reason}</p>
                                                    )}
                                                    <button
                                                        onClick={() => { setOpenMenuTracked(null); setVariant(null); setEngineOverride(null); showOsd("Auto stream"); }}
                                                        className={POPUP_ITEM}
                                                        data-active={engineOverride === null && !variant}
                                                    >
                                                        Auto
                                                    </button>
                                                    <button
                                                        onClick={() => { setOpenMenuTracked(null); stopDeviceSession(); setEngineOverride("original"); showOsd("Original file"); }}
                                                        className={cn(POPUP_ITEM, "flex items-center justify-between gap-3")}
                                                        data-active={!isUsingTranscodedStream && !deviceSession && engineOverride === "original"}
                                                    >
                                                        <span>Original file</span>
                                                        {streamInfo && (
                                                            <span className="text-[10px] text-white/45">
                                                                {[codecLabel(streamInfo.videoCodec), streamInfo.height ? `${streamInfo.height}p` : ""].filter(Boolean).join(" ")}
                                                            </span>
                                                        )}
                                                    </button>
                                                    {deviceSupported && (
                                                        <button
                                                            onClick={() => { setOpenMenuTracked(null); setEngineOverride("device"); }}
                                                            className={cn(POPUP_ITEM, "flex items-center justify-between gap-3")}
                                                            data-active={!!deviceSession}
                                                        >
                                                            <span>On this device</span>
                                                            <span className="text-[10px] text-white/45">Original video · audio → AAC</span>
                                                        </button>
                                                    )}
                                                    {streamInfo && <div className={cn(POPUP_LABEL, "mt-1")}>Compatible (transcoded by provider)</div>}
                                                    {streamInfo?.resolutions.map((r) => (
                                                        <button
                                                            key={r.label}
                                                            onClick={() => {
                                                                setOpenMenuTracked(null);
                                                                void switchStreamVariant({ resolutionIndex: r.index }, `Compatible · ${r.label}`);
                                                            }}
                                                            className={POPUP_ITEM}
                                                            data-active={isUsingTranscodedStream && !deviceSession && streamInfo.resolutionIndex === r.index}
                                                        >
                                                            {r.label}
                                                        </button>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {/* Audio track selector (native / hls.js tracks) */}
                                    {!deviceSession && !(streamInfo && streamInfo.audios.length > 1) && audioTrackCount > 1 && (
                                        <DropdownMenu
                                            open={openMenu === "audio"}
                                            onOpenChange={(open) => setOpenMenuTracked(open ? "audio" : null)}
                                        >
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        PLAYER_BTN_SM,
                                                        "text-[11px] font-medium tracking-wide",
                                                        openMenu === "audio" && "bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.12)] text-white"
                                                    )}
                                                    data-tv-focusable
                                                >
                                                    Audio
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    collisionBoundary={containerRef.current ?? undefined}
                                                    collisionPadding={8}
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[200px] z-50 p-1")}
                                                    style={POPUP_STYLE}
                                                >
                                                    <div className={POPUP_LABEL}>Audio Tracks</div>
                                                    {Array.from({ length: audioTrackCount }, (_, i) => {
                                                        let label: string;
                                                        if (hlsAudioTracks.length > i) {
                                                            const ht = hlsAudioTracks[i];
                                                            const langLabel = ht.lang ? getLanguageDisplayName(ht.lang) : "";
                                                            const base = (ht.name ?? "").trim();
                                                            label = [langLabel, base].filter(Boolean).join(" · ") || `Track ${i + 1}`;
                                                        } else {
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
                                                            label =
                                                                [langLabel, base].filter(Boolean).join(" · ") ||
                                                                `Track ${i + 1}`;
                                                        }
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
                                                    type="button"
                                                    className={cn(
                                                        PLAYER_BTN_SM,
                                                        "text-[11px] font-medium tracking-wide",
                                                        activeSubtitleIndex >= 0 && "text-primary",
                                                        openMenu === "subtitles" && "bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                                                    )}
                                                    data-tv-focusable
                                                >
                                                    CC
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    collisionBoundary={containerRef.current ?? undefined}
                                                    collisionPadding={8}
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[180px] z-50 p-1")}
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
                                                    {displayedSubtitles.map((sub, i) => (
                                                        <button
                                                            key={`${sub.source ?? "addon"}-${sub.lang}-${sub.url ?? sub.trackId ?? ""}-${i}`}
                                                            onClick={() => { userSetSubtitleRef.current = true; setActiveSubtitleIndex(i); setOpenMenuTracked(null); }}
                                                            className={POPUP_ITEM}
                                                            data-active={activeSubtitleIndex === i}
                                                        >
                                                            <span className="flex-1 truncate">{sub.name ?? getLanguageDisplayName(sub.lang)}</span>
                                                            {sub.source === "embedded" && (
                                                                <span className="ml-2 text-[9px] tracking-widest uppercase text-white/40">embed</span>
                                                            )}
                                                        </button>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenuPortal>
                                        </DropdownMenu>
                                    )}

                                    {/* Alternate addon streams (same title) — compact, only when multiple sources exist */}
                                    {showInlineSourcePicker && (
                                        <DropdownMenu
                                            open={openMenu === "streams"}
                                            onOpenChange={(open) => setOpenMenuTracked(open ? "streams" : null)}
                                        >
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        PLAYER_BTN_SM,
                                                        "relative",
                                                        openMenu === "streams" && "bg-white/[0.12] text-primary shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                                                    )}
                                                    title="Change stream"
                                                    aria-label="Change stream source"
                                                    aria-expanded={openMenu === "streams"}
                                                    data-tv-focusable
                                                >
                                                    <Layers
                                                        className={cn(
                                                            "h-5 w-5 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none",
                                                            openMenu === "streams" && "scale-[1.06]"
                                                        )}
                                                    />
                                                    <span className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-[2px] bg-primary/90 text-[9px] font-semibold leading-none text-primary-foreground flex items-center justify-center tabular-nums">
                                                        {allFetchedSources.length}
                                                    </span>
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                                <DropdownMenuContent
                                                    collisionBoundary={containerRef.current ?? undefined}
                                                    collisionPadding={8}
                                                    data-player-controls
                                                    align="end"
                                                    side="top"
                                                    sideOffset={4}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    className={cn(POPUP_CLS, "min-w-[240px] max-w-[min(92vw,320px)] z-50 p-0 overflow-hidden")}
                                                    style={POPUP_STYLE}
                                                >
                                                    <div className={POPUP_LABEL}>Streams</div>
                                                    <div className="max-h-[min(280px,42vh)] overflow-y-auto overflow-x-hidden py-0.5">
                                                        {allFetchedSources.map((src, idx) => {
                                                            const active = src.url === selectedSourceFromStore?.url;
                                                            const line = [src.resolution, src.quality, src.size].filter(Boolean).join(" · ");
                                                            return (
                                                                <button
                                                                    key={`${src.url}-${idx}`}
                                                                    type="button"
                                                                    onClick={() => pickAlternateSource(src)}
                                                                    className={POPUP_ITEM}
                                                                    data-active={active}
                                                                    disabled={active}
                                                                >
                                                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                                                                        <span className="truncate text-[13px] text-white/95">
                                                                            {src.title || src.addonName || `Source ${idx + 1}`}
                                                                        </span>
                                                                        <span className="truncate text-[11px] text-white/45">
                                                                            {[src.addonName, line].filter(Boolean).join(" · ") || "Addon stream"}
                                                                        </span>
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setOpenMenuTracked(null); openSourcePicker(); }}
                                                        className={cn(POPUP_ITEM, "border-t border-white/10 justify-center gap-1.5 text-[11px] text-white/60 hover:text-white")}
                                                    >
                                                        <Layers className="size-3.5" />
                                                        Show all sources · filter &amp; sort
                                                    </button>
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
                                                type="button"
                                                className={cn(
                                                    PLAYER_BTN_SM,
                                                    openMenu === "settings" && "bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                                                )}
                                                data-tv-focusable
                                            >
                                                <Settings
                                                    className={cn(
                                                        "h-5 w-5 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none",
                                                        openMenu === "settings" && "rotate-90 text-primary"
                                                    )}
                                                />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuPortal container={containerRef.current ?? undefined}>
                                            <DropdownMenuContent
                                                collisionBoundary={containerRef.current ?? undefined}
                                                collisionPadding={8}
                                                data-player-controls
                                                align="end"
                                                side="top"
                                                sideOffset={4}
                                                onClick={(e) => e.stopPropagation()}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                                className={cn(POPUP_CLS, "w-[250px] z-50")}
                                                style={POPUP_STYLE}
                                            >
                                                {/* === Main settings panel === */}
                                                {settingsPanel === null && (
                                                    <div className="py-1">
                                                        {/* Speed row */}
                                                        <button
                                                            onClick={() => setSettingsPanel("speed")}
                                                            className={POPUP_ITEM}
                                                            data-tv-focusable
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
                                                                data-tv-focusable
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
                                                                data-tv-focusable
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
                                                                        video.requestPictureInPicture().catch(() => { });
                                                                        showOsd("Picture in Picture");
                                                                    }
                                                                    setOpenMenuTracked(null);
                                                                    setSettingsPanel(null);
                                                                }}
                                                                className={POPUP_ITEM}
                                                                data-tv-focusable
                                                            >
                                                                <PictureInPicture2 className="size-3.5 opacity-60" /> Picture in Picture
                                                            </button>
                                                        )}
                                                        {/* Audio Normalization */}
                                                        <button
                                                            onClick={toggleAudioNormalization}
                                                            className={POPUP_ITEM}
                                                            data-tv-focusable
                                                        >
                                                            <Volume2 className={cn("size-3.5 opacity-60", audioNormalization && "text-primary opacity-100")} />
                                                            <span className="flex-1">Normalize audio</span>
                                                            <div className={cn(
                                                                "w-6 h-3 rounded-full relative transition-colors duration-200",
                                                                audioNormalization ? "bg-primary" : "bg-white/10"
                                                            )}>
                                                                <div className={cn(
                                                                    "absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform duration-200",
                                                                    audioNormalization ? "translate-x-3.5" : "translate-x-0.5"
                                                                )} />
                                                            </div>
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                void runBufferingSpeedProbe({ auto: false });
                                                            }}
                                                            className={POPUP_ITEM}
                                                            disabled={isSpeedProbeRunning}
                                                            data-tv-focusable
                                                        >
                                                            <RefreshCw className={cn("size-3.5 opacity-60", isSpeedProbeRunning && "animate-spin")} />
                                                            <span className="flex-1">Network test</span>
                                                            <span className="text-[11px] text-white/40 tabular-nums">
                                                                {lastSpeedProbeMbps ? `${lastSpeedProbeMbps.toFixed(1)} Mbps` : "2MB sample"}
                                                            </span>
                                                        </button>
                                                    </div>
                                                )}

                                                {/* === Speed sub-panel === */}
                                                {settingsPanel === "speed" && (
                                                    <div
                                                        className="py-1">
                                                        <button onClick={() => setSettingsPanel(null)} className={cn(POPUP_ITEM, "gap-1.5 text-white/50 hover:text-white")} data-tv-focusable>
                                                            <ArrowLeft className="size-3.5" /> <span className="text-[12px]">Back</span>
                                                        </button>
                                                        <div className={POPUP_DIVIDER} />
                                                        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                                                            <button
                                                                key={rate}
                                                                onClick={() => { setPlaybackRate(rate); showSpeedOsd(rate); setSettingsPanel(null); }}
                                                                className={POPUP_ITEM}
                                                                data-active={playbackRate === rate}
                                                                data-tv-focusable
                                                            >
                                                                {rate === 1 ? "Normal" : `${rate}x`}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* === Subtitles sub-panel === */}
                                                {settingsPanel === "subtitles" && (
                                                    <div className="py-1">
                                                        <button onClick={() => setSettingsPanel(null)} className={cn(POPUP_ITEM, "gap-1.5 text-white/50 hover:text-white")} data-tv-focusable>
                                                            <ArrowLeft className="size-3.5" /> <span className="text-[12px]">Back</span>
                                                        </button>
                                                        <div className={POPUP_DIVIDER} />
                                                        {/* Size */}
                                                        <div className={POPUP_LABEL}>Size</div>
                                                        <div
                                                            className="player-stepper flex items-center justify-between px-3.5 pt-1 pb-2"
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
                                                        >
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSubtitlePosition((s) => Math.max(0, s - 4))}
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
                                                        {/* Speed — fixes fps-mismatch drift (e.g. PAL 25→NTSC 23.976) */}
                                                        <div className={POPUP_LABEL}>Speed</div>
                                                        <div
                                                            className="player-stepper flex items-center justify-between px-3.5 pt-1 pb-2"
                                                        >
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSyncState((s) => ({ ...s, speed: Math.max(0.9, +(s.speed - 0.001).toFixed(4)) }))}
                                                                title="Slower (−0.1%)"
                                                            >
                                                                <Minus className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button
                                                                className="player-stepper-value text-xs tabular-nums font-mono text-white/70 hover:text-primary transition-colors bg-transparent border-none cursor-pointer"
                                                                title="Click to reset to 100%"
                                                                onClick={() => setSyncState((s) => ({ ...s, speed: 1 }))}
                                                            >
                                                                {(syncState.speed * 100).toFixed(1)}%
                                                            </button>
                                                            <button
                                                                className="player-stepper-btn w-[30px] h-[30px] inline-flex items-center justify-center rounded-full bg-white/[0.06] border-none text-white/70 cursor-pointer transition-all hover:bg-white/[0.12] hover:text-white active:scale-[0.88]"
                                                                onClick={() => setSyncState((s) => ({ ...s, speed: Math.min(1.1, +(s.speed + 0.001).toFixed(4)) }))}
                                                                title="Faster (+0.1%)"
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        {/* Two-point sync anchors — locks the offset at two moments,
                                                            then linearly interpolates between them. Fixes drift that
                                                            isn't a uniform fps mismatch (edit differences, ad breaks). */}
                                                        <div className={POPUP_LABEL}>Sync anchors</div>
                                                        <div className="flex items-center gap-1.5 px-3.5 pt-1 pb-1">
                                                            <button
                                                                onClick={() => {
                                                                    const v = videoRef.current?.currentTime ?? 0;
                                                                    setSyncState((prev) => ({ ...prev, pointA: captureSyncPoint(v, prev) }));
                                                                    showOsd("Sync point A set");
                                                                }}
                                                                className={cn(
                                                                    "flex-1 text-[10px] py-1 rounded-sm border transition-colors cursor-pointer",
                                                                    syncState.pointA
                                                                        ? "border-primary/60 bg-primary/10 text-white"
                                                                        : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80"
                                                                )}
                                                                title="Mark current time as sync anchor A"
                                                            >
                                                                {syncState.pointA ? `A · ${syncState.pointA.videoAt.toFixed(0)}s` : "Set A"}
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    const v = videoRef.current?.currentTime ?? 0;
                                                                    setSyncState((prev) => ({ ...prev, pointB: captureSyncPoint(v, prev) }));
                                                                    showOsd("Sync point B set");
                                                                }}
                                                                className={cn(
                                                                    "flex-1 text-[10px] py-1 rounded-sm border transition-colors cursor-pointer",
                                                                    syncState.pointB
                                                                        ? "border-primary/60 bg-primary/10 text-white"
                                                                        : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80"
                                                                )}
                                                                title="Mark current time as sync anchor B"
                                                            >
                                                                {syncState.pointB ? `B · ${syncState.pointB.videoAt.toFixed(0)}s` : "Set B"}
                                                            </button>
                                                            <button
                                                                onClick={() => setSyncState(INITIAL_SUBTITLE_SYNC)}
                                                                className="text-[10px] py-1 px-2 rounded-sm border border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70 transition-colors cursor-pointer"
                                                                title="Clear delay, speed, and sync anchors"
                                                                disabled={syncState.delayMs === 0 && syncState.speed === 1 && !syncState.pointA && !syncState.pointB}
                                                            >
                                                                Reset
                                                            </button>
                                                        </div>
                                                        <div className="px-3.5 pb-2 text-[10px] text-white/40">
                                                            {describeSync(syncState)}
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
                                                        <button onClick={() => setSettingsPanel(null)} className={cn(POPUP_ITEM, "gap-1.5 text-white/50 hover:text-white")} data-tv-focusable>
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
                                                                    data-tv-focusable
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
                                        downloadUrl={effectiveUrl || downloadUrl}
                                        title={file.name}
                                        subtitles={subtitles}
                                    />

                                    {/* Fullscreen — hidden in TV mode where fullscreen is the default */}
                                    {!tvMode && (
                                        <button
                                            className={PLAYER_BTN_SM}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleFullscreen();
                                            }}
                                            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                                            data-tv-focusable
                                        >
                                            {isFullscreen ? (
                                                <Minimize2 className="h-5 w-5" />
                                            ) : (
                                                <Maximize2 className="h-5 w-5" />
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* iOS: tap-to-play overlay so playback runs in user gesture context */}
                    {ios && iosTapToPlay && !isTransitioning && !awaitingHls && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleIosTapToPlay(); }}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-white z-50">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/15">
                                <Play weight="Filled" className="h-10 w-10 ml-1" />
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
                    {showLoadingHint && !isTransitioning && (
                        <div data-player-controls onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} className="absolute bottom-16 left-0 right-0 z-50 border-t border-white/10 bg-black/95 px-4 py-3 text-center text-xs text-white sm:bottom-20 sm:left-4 sm:right-4 sm:rounded-sm sm:border">
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
