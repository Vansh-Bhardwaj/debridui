"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    AudioLines,
    Captions,
    Check,
    ChevronRight,
    ExternalLink,
    Gauge,
    Layers,
    Loader2,
    Maximize,
    Pause,
    Play,
    RefreshCw,
    Settings2,
    SkipBack,
    SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MediaPlayer, type DebridFileNode } from "@/lib/types";
import type { AddonSubtitle } from "@/lib/addons/types";
import { useProgress, type ProgressKey } from "@/hooks/use-progress";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useSettingsStore } from "@/lib/stores/settings";
import { getStreamInfo, type StreamInfo, type StreamVariantOptions } from "@/lib/streaming/stream-info";
import { detectContainer, getDeviceProfile, isMp4Family } from "@/lib/playback/device-profile";
import { enterNativeFullscreen, type NativeFullscreenVideo } from "@/lib/playback/native-fullscreen";
import { isSupportedPlayer, openInPlayer } from "@/lib/utils/media-player";
import { getLanguageDisplayName, isSubtitleLanguage } from "@/lib/utils/subtitles";
import { buildNativeHlsUrl, isPlaylistReachable, pickNativeSubtitles, waitForHlsReady } from "@/lib/playback/native-hls";

/** Library lookup incl. retries while a just-added torrent appears (see preview-dialog). */
const LINKS_WAIT_MS = 90_000;
/** How long the provider may take to produce the first converted segment. */
const CONVERT_WAIT_MS = 120_000;
/** Give background subtitle fetches time so the stream starts with them built in. */
const SUBTITLE_GRACE_MS = 6_000;
const SAVE_EVERY_S = 5;
const HIDE_CONTROLS_MS = 3_000;
const DOUBLE_TAP_MS = 260;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const EXTERNAL_PLAYERS = [MediaPlayer.INFUSE, MediaPlayer.VLC, MediaPlayer.KODI];

type Sheet = "quality" | "audio" | "subtitles" | "speed" | null;

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    return h ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

interface NativeVideoPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    streamingLinks?: Record<string, string>;
    subtitles?: AddonSubtitle[];
    progressKey?: ProgressKey;
    onNext?: () => void;
    onPrev?: () => void;
}

/**
 * Phone player (iPhone / iPad route): YouTube-style inline playback of the
 * provider's converted stream. Video on top, choices below in portrait; full
 * bleed in landscape. Subtitles ride inside the HLS stream (lib/playback/native-hls.ts)
 * so they also show in Apple's player when going fullscreen.
 */
export function NativeVideoPreview({ file, downloadUrl, streamingLinks, subtitles, progressKey, onNext, onPrev }: NativeVideoPreviewProps) {
    const device = getDeviceProfile()?.label.split(" · ")[0] ?? "this device";
    const videoRef = useRef<HTMLVideoElement>(null);
    const source = useStreamingStore((s) => s.selectedSource);
    const openSourcePicker = useStreamingStore((s) => s.openSourcePicker);
    const allSources = useStreamingStore((s) => s.allFetchedSources);
    const playAlternativeSource = useStreamingStore((s) => s.playAlternativeSource);
    const otherSources = useMemo(
        () => allSources.filter((s) => s.url && s.url !== source?.url).slice(0, 8),
        [allSources, source?.url]
    );
    const subtitleLanguage = useSettingsStore((s) => s.settings.playback.subtitleLanguage);
    const { initialProgress, updateProgress, forceSync, markCompleted } = useProgress(progressKey ?? null);

    // ── Preparation: find the file → provider converts → subtitles → ready ──
    // Every step waits patiently and shows progress. The player is keyed per source
    // (video-preview.tsx), and nothing here swaps the stream once it is playing.
    const [linksTimedOut, setLinksTimedOut] = useState(false);
    const [subsGraceOver, setSubsGraceOver] = useState(false);
    useEffect(() => {
        const links = setTimeout(() => setLinksTimedOut(true), LINKS_WAIT_MS);
        const subs = setTimeout(() => setSubsGraceOver(true), SUBTITLE_GRACE_MS);
        return () => {
            clearTimeout(links);
            clearTimeout(subs);
        };
    }, []);
    const findingFile = !downloadUrl || (streamingLinks === undefined && !linksTimedOut);

    const [variant, setVariant] = useState<StreamInfo | null>(null);
    const hlsUrl = variant?.hlsUrl ?? streamingLinks?.apple;
    const info = variant ?? getStreamInfo(hlsUrl);
    const container = detectContainer(source?.fileName, file.name, downloadUrl);

    // Video step: the provider has produced the first converted segment.
    const [videoCheck, setVideoCheck] = useState<{ url: string; ok: boolean } | null>(null);
    useEffect(() => {
        if (!hlsUrl) return;
        const controller = new AbortController();
        void waitForHlsReady(hlsUrl, controller.signal, CONVERT_WAIT_MS).then((ok) => {
            if (!controller.signal.aborted) setVideoCheck((c) => (c?.url === hlsUrl ? c : { url: hlsUrl, ok }));
        });
        return () => controller.abort();
    }, [hlsUrl]);
    const videoReady = videoCheck && videoCheck.url === hlsUrl ? videoCheck.ok : null; // null = still converting

    // Subtitle step: built into the stream once (never rebuilt mid-play).
    const nativeSubs = useMemo(() => pickNativeSubtitles(subtitles, subtitleLanguage), [subtitles, subtitleLanguage]);
    const subsSettled = nativeSubs.length > 0 || subsGraceOver;
    const [master, setMaster] = useState<{ hls: string; url: string; subs: AddonSubtitle[] } | null>(null);
    const masterForStream = master && master.hls === hlsUrl ? master : null;
    useEffect(() => {
        if (!hlsUrl || !subsSettled || masterForStream) return;
        let cancelled = false;
        const subs = nativeSubs;
        buildNativeHlsUrl(hlsUrl, subs, subtitleLanguage)
            .then(async (url) => (url === hlsUrl || (await isPlaylistReachable(url)) ? url : hlsUrl))
            .catch(() => hlsUrl)
            .then((url) => {
                if (!cancelled) setMaster({ hls: hlsUrl, url, subs: url === hlsUrl ? [] : subs });
            });
        return () => {
            cancelled = true;
        };
    }, [hlsUrl, subsSettled, masterForStream, nativeSubs, subtitleLanguage]);

    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    // Converted stream when the provider has one; the original only for MP4-family (or unknown) files.
    const src = hlsUrl
        ? videoReady && masterForStream
            ? masterForStream.url
            : null
        : !findingFile && !(container && !isMp4Family(container))
          ? downloadUrl
          : null;
    const failed = (!findingFile && (hlsUrl ? videoReady === false : !src)) || (!!src && failedSrc === src);
    const preparing = !src && !failed;
    const steps: { label: string; state: "done" | "active" | "waiting" }[] = [
        { label: "Finding the file in your library", state: findingFile ? "active" : "done" },
        {
            label: `Converting video${info?.height ? ` (${info.height}p)` : ""}`,
            state: !hlsUrl ? "waiting" : videoReady ? "done" : "active",
        },
        {
            label: masterForStream
                ? masterForStream.subs.length
                    ? `Subtitles ready (${masterForStream.subs.length})`
                    : "No subtitles available"
                : "Loading subtitles",
            state: !hlsUrl ? "waiting" : masterForStream ? "done" : "active",
        },
    ];

    // ── Playback state ────────────────────────────────────────────────────
    const [playing, setPlaying] = useState(false);
    const [buffering, setBuffering] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedEnd, setBufferedEnd] = useState(0);
    const [ended, setEnded] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [sheet, setSheet] = useState<Sheet>(null);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [seekFlash, setSeekFlash] = useState<{ side: "left" | "right"; id: number } | null>(null);
    const [textTracks, setTextTracks] = useState<{ index: number; label: string; language: string }[]>([]);
    const [activeTrack, setActiveTrack] = useState(-1);
    const [switching, setSwitching] = useState(false);

    // Position survives an audio/quality switch on the same element.
    const positionRef = useRef(0);
    const wasPlayingRef = useRef(false);
    const lastSavedRef = useRef(0);

    const handleLoadedMetadata = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        setDuration(video.duration);
        const at = positionRef.current > 1 ? positionRef.current : (initialProgress ?? 0);
        if (at > 5 && (!video.duration || at < video.duration - 30)) video.currentTime = at;
        video.playbackRate = speed;
        // WebKit allows play() without a new tap once the user has played this element.
        if (wasPlayingRef.current) void video.play().catch(() => setBuffering(false));
    }, [initialProgress, speed]);

    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        positionRef.current = video.currentTime;
        setTime(video.currentTime);
        if (video.buffered.length) setBufferedEnd(video.buffered.end(video.buffered.length - 1));
        if (Math.abs(video.currentTime - lastSavedRef.current) >= SAVE_EVERY_S) {
            lastSavedRef.current = video.currentTime;
            updateProgress(video.currentTime, video.duration);
        }
    }, [updateProgress]);

    // Subtitle renditions from the HLS stream show up as native text tracks.
    // The preferred language is switched on when it appears, unless the user chose.
    const userPickedTrackRef = useRef(false);
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;
        const list = video.textTracks;
        const sync = () => {
            const all = Array.from(list);
            if (!userPickedTrackRef.current && !all.some((t) => t.mode === "showing")) {
                const preferred = all.find(
                    (t) => (t.kind === "subtitles" || t.kind === "captions") && isSubtitleLanguage({ url: "", lang: t.language || t.label }, subtitleLanguage)
                );
                if (preferred) preferred.mode = "showing";
            }
            const tracks = all
                .map((t, index) => ({ index, label: t.label || getLanguageDisplayName(t.language || "und"), language: t.language, kind: t.kind }))
                .filter((t) => t.kind === "subtitles" || t.kind === "captions");
            setTextTracks(tracks);
            setActiveTrack(Array.from(list).findIndex((t) => t.mode === "showing"));
        };
        sync();
        list.addEventListener("addtrack", sync);
        list.addEventListener("removetrack", sync);
        list.addEventListener("change", sync);
        return () => {
            list.removeEventListener("addtrack", sync);
            list.removeEventListener("removetrack", sync);
            list.removeEventListener("change", sync);
        };
    }, [src, subtitleLanguage]);
    const showTrack = useCallback((index: number) => {
        const list = videoRef.current?.textTracks;
        if (!list) return;
        Array.from(list).forEach((t, i) => (t.mode = i === index ? "showing" : "disabled"));
        setActiveTrack(index);
    }, []);

    // ── Controls ──────────────────────────────────────────────────────────
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pokeControls = useCallback(() => {
        setControlsVisible(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
            if (!videoRef.current?.paused) setControlsVisible(false);
        }, HIDE_CONTROLS_MS);
    }, []);
    useEffect(() => () => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }, []);

    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        pokeControls();
        if (video.paused || video.ended) {
            // Immediate feedback: HLS can take a few seconds to start.
            setBuffering(true);
            setEnded(false);
            void video.play().catch(() => setBuffering(false));
        } else {
            video.pause();
        }
    }, [pokeControls]);

    const seekBy = useCallback((delta: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = Math.max(0, Math.min((video.duration || Infinity) - 1, video.currentTime + delta));
        setSeekFlash({ side: delta < 0 ? "left" : "right", id: Date.now() });
    }, []);

    // Single tap toggles controls; double tap on the left/right half seeks ±10s.
    const lastTapRef = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null }>({ at: 0, timer: null });
    const handleSurfaceTap = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const side = e.clientX - rect.left < rect.width / 2 ? "left" : "right";
            const now = Date.now();
            const tap = lastTapRef.current;
            if (now - tap.at < DOUBLE_TAP_MS) {
                if (tap.timer) clearTimeout(tap.timer);
                tap.at = 0;
                seekBy(side === "left" ? -10 : 10);
                pokeControls();
                return;
            }
            tap.at = now;
            tap.timer = setTimeout(() => {
                setControlsVisible((visible) => {
                    if (!visible) pokeControls();
                    return !visible;
                });
            }, DOUBLE_TAP_MS);
        },
        [seekBy, pokeControls]
    );

    const goFullscreen = useCallback(() => {
        const video = videoRef.current as NativeFullscreenVideo | null;
        if (!video) return;
        // iPhone: Apple's player (subtitles + AirPlay). iPad: element fullscreen keeps our controls.
        const host = video.parentElement as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
        if (getDeviceProfile()?.kind === "ipad" && host?.webkitRequestFullscreen) host.webkitRequestFullscreen();
        else enterNativeFullscreen(video);
    }, []);

    // Audio/quality: prepare the new provider session fully (converted + subtitles)
    // while the current one keeps playing, then swap in one step at the same position.
    const switchVariant = useCallback(
        async (opts: StreamVariantOptions) => {
            if (!info) return;
            setSheet(null);
            setSwitching(true);
            const next = await info.switchVariant(opts).catch(() => null);
            const ready = next ? await waitForHlsReady(next.hlsUrl, new AbortController().signal, CONVERT_WAIT_MS) : false;
            if (!next || !ready) {
                setSwitching(false);
                toast.error("Couldn't switch the stream. Try again in a moment.");
                return;
            }
            const subs = master?.subs ?? [];
            const url = await buildNativeHlsUrl(next.hlsUrl, subs, subtitleLanguage).catch(() => next.hlsUrl);
            wasPlayingRef.current = !videoRef.current?.paused;
            setVideoCheck({ url: next.hlsUrl, ok: true });
            setMaster({ hls: next.hlsUrl, url, subs: url === next.hlsUrl ? [] : subs });
            setVariant(next);
            setSwitching(false);
        },
        [info, master, subtitleLanguage]
    );

    const tryNextSource = () => {
        if (!useStreamingStore.getState().playNextBestSource()) toast.error("No other sources to try.");
    };
    const externalPlayers = EXTERNAL_PLAYERS.filter((p) => isSupportedPlayer(p));

    const currentAudio = info?.audios.find((a) => a.index === info.audioIndex);
    const currentQuality = info?.resolutions.find((r) => r.index === info.resolutionIndex)?.label ?? info?.resolutions[0]?.label;
    const chips: { id: Exclude<Sheet, null> | "source"; icon: typeof Gauge; label: string; value: string; show: boolean }[] = [
        { id: "source", icon: Layers, label: "Source", value: [source?.resolution, source?.quality].filter(Boolean).join(" ") || "Change", show: !!source },
        { id: "quality", icon: Settings2, label: "Quality", value: currentQuality?.replace(/^Original \((.+)\)$/, "$1") ?? "Auto", show: (info?.resolutions.length ?? 0) > 1 },
        {
            id: "audio",
            icon: AudioLines,
            label: "Audio",
            value: currentAudio?.language ? getLanguageDisplayName(currentAudio.language) : "Default",
            show: (info?.audios.length ?? 0) > 1,
        },
        { id: "subtitles", icon: Captions, label: "Subtitles", value: textTracks.find((t) => t.index === activeTrack)?.label ?? "Off", show: textTracks.length > 0 },
        { id: "speed", icon: Gauge, label: "Speed", value: speed === 1 ? "Normal" : `${speed}×`, show: true },
    ];

    const sheetOptions: { key: string; label: string; active: boolean; onSelect: () => void }[] =
        sheet === "quality"
            ? (info?.resolutions ?? []).map((r) => ({
                  key: String(r.index),
                  label: r.label,
                  active: r.index === info?.resolutionIndex,
                  onSelect: () => void switchVariant({ resolutionIndex: r.index }),
              }))
            : sheet === "audio"
              ? (info?.audios ?? []).map((a) => ({
                    key: String(a.index),
                    label: [a.language ? getLanguageDisplayName(a.language) : `Track ${a.index + 1}`, a.title, a.channels ? `${a.channels}ch` : null]
                        .filter(Boolean)
                        .join(" · "),
                    active: a.index === info?.audioIndex,
                    onSelect: () => void switchVariant({ audioIndex: a.index }),
                }))
              : sheet === "subtitles"
                ? [{ index: -1, label: "Off" }, ...textTracks].map((t) => ({
                      key: String(t.index),
                      label: t.label,
                      active: t.index === activeTrack,
                      onSelect: () => {
                          userPickedTrackRef.current = true;
                          showTrack(t.index);
                          setSheet(null);
                      },
                  }))
                : sheet === "speed"
                  ? SPEEDS.map((s) => ({
                        key: String(s),
                        label: s === 1 ? "Normal" : `${s}×`,
                        active: s === speed,
                        onSelect: () => {
                            setSpeed(s);
                            if (videoRef.current) videoRef.current.playbackRate = s;
                            setSheet(null);
                        },
                    }))
                  : [];

    const progressPct = duration ? (time / duration) * 100 : 0;
    const bufferedPct = duration ? (bufferedEnd / duration) * 100 : 0;
    const showOverlay = controlsVisible || !playing || buffering || ended;

    return (
        <div className="relative flex h-full w-full flex-col bg-black text-white portrait:overflow-y-auto">
            {/* ── Video (16:9 in portrait, full bleed in landscape) ── */}
            <div
                className="native-player relative w-full shrink-0 bg-black portrait:aspect-video landscape:min-h-0 landscape:flex-1"
                data-controls={showOverlay ? "true" : undefined}>
                {preparing ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
                        <p className="text-sm font-medium">Getting this ready for {device}</p>
                        <ul className="space-y-2.5">
                            {steps.map((step) => (
                                <li key={step.label} className={cn("flex items-center gap-2.5 text-sm", step.state === "waiting" && "text-white/35")}>
                                    {step.state === "done" ? (
                                        <Check className="size-4 text-primary" />
                                    ) : step.state === "active" ? (
                                        <Loader2 className="size-4 animate-spin text-white/70" />
                                    ) : (
                                        <span className="size-4 rounded-full border border-white/25" />
                                    )}
                                    {step.label}
                                </li>
                            ))}
                        </ul>
                        <p className="max-w-xs text-center text-xs leading-relaxed text-white/45">
                            Your provider converts the file so it plays here. Large files can take a minute.
                        </p>
                    </div>
                ) : failed ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-4 text-center">
                        <AlertCircle className="size-6 text-white/60" />
                        <div className="space-y-1">
                            <p className="text-sm font-medium">This source can&apos;t play on {device}</p>
                            <p className="max-w-sm text-xs leading-relaxed text-white/50">
                                {hlsUrl
                                    ? "Your provider didn't finish converting this file in time."
                                    : "Your provider doesn't have this file ready yet (it may still be downloading). A cached source usually plays right away."}
                            </p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2">
                            {source && (
                                <Button size="sm" onClick={tryNextSource}>
                                    <RefreshCw className="size-4" /> Next source
                                </Button>
                            )}
                            {externalPlayers.map((player) => (
                                <Button
                                    key={player}
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openInPlayer({ url: downloadUrl, fileName: file.name, player, progressKey })}>
                                    <ExternalLink className="size-4" /> {player}
                                </Button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        <video
                            ref={videoRef}
                            src={src ?? undefined}
                            playsInline
                            preload="metadata"
                            className="absolute inset-0 h-full w-full object-contain"
                            onLoadedMetadata={handleLoadedMetadata}
                            onTimeUpdate={handleTimeUpdate}
                            onProgress={handleTimeUpdate}
                            onPlay={() => {
                                wasPlayingRef.current = true;
                                setPlaying(true);
                                pokeControls();
                            }}
                            onPlaying={() => setBuffering(false)}
                            onWaiting={() => setBuffering(true)}
                            onCanPlay={() => setBuffering((b) => (videoRef.current?.paused ? false : b))}
                            onPause={() => {
                                wasPlayingRef.current = false;
                                setPlaying(false);
                                setBuffering(false);
                                setControlsVisible(true);
                                forceSync();
                            }}
                            onEnded={() => {
                                setEnded(true);
                                markCompleted();
                            }}
                            onError={() => {
                                setBuffering(false);
                                // Subtitle wrapper failed → play the provider stream without it.
                                if (masterForStream && src === masterForStream.url && src !== hlsUrl) {
                                    setMaster({ ...masterForStream, url: masterForStream.hls, subs: [] });
                                } else {
                                    setFailedSrc(src ?? null);
                                }
                            }}
                        />

                        {/* Tap surface: show/hide controls, double-tap ±10s */}
                        <div className="absolute inset-0" onClick={handleSurfaceTap} />

                        {seekFlash && (
                            <div
                                key={seekFlash.id}
                                className={cn(
                                    "pointer-events-none absolute inset-y-0 flex w-1/3 items-center justify-center animate-out fade-out-0 duration-700 fill-mode-forwards",
                                    seekFlash.side === "left" ? "left-0" : "right-0"
                                )}>
                                <span className="rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium">
                                    {seekFlash.side === "left" ? "−10s" : "+10s"}
                                </span>
                            </div>
                        )}

                        <div
                            className={cn(
                                "pointer-events-none absolute inset-0 transition-opacity duration-200",
                                showOverlay ? "opacity-100" : "opacity-0"
                            )}>
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30" />

                            {/* Center: prev · play/pause (spinner while loading) · next */}
                            <div className="absolute inset-0 flex items-center justify-center gap-10">
                                <button
                                    type="button"
                                    aria-label="Previous"
                                    disabled={!onPrev}
                                    onClick={onPrev}
                                    className={cn("pointer-events-auto rounded-full p-2 disabled:opacity-0", !showOverlay && "pointer-events-none")}>
                                    <SkipBack className="size-6 fill-current" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={playing ? "Pause" : "Play"}
                                    onClick={togglePlay}
                                    className={cn(
                                        "pointer-events-auto flex size-16 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm active:scale-95",
                                        !showOverlay && "pointer-events-none"
                                    )}>
                                    {buffering || switching ? (
                                        <Loader2 className="size-8 animate-spin" />
                                    ) : playing ? (
                                        <Pause className="size-8 fill-current" />
                                    ) : (
                                        <Play className="ml-1 size-8 fill-current" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    aria-label="Next"
                                    disabled={!onNext}
                                    onClick={onNext}
                                    className={cn("pointer-events-auto rounded-full p-2 disabled:opacity-0", !showOverlay && "pointer-events-none")}>
                                    <SkipForward className="size-6 fill-current" />
                                </button>
                            </div>

                            {/* Bottom: time · fullscreen, then the scrubber */}
                            <div className={cn("absolute inset-x-0 bottom-0 px-3 pb-1", !showOverlay && "[&_*]:pointer-events-none")}>
                                <div className="flex items-center justify-between text-xs tabular-nums">
                                    <span>
                                        {formatTime(time)} <span className="text-white/60">/ {formatTime(duration)}</span>
                                    </span>
                                    <button type="button" aria-label="Fullscreen" onClick={goFullscreen} className="pointer-events-auto p-2">
                                        <Maximize className="size-5" />
                                    </button>
                                </div>
                                <div className="relative flex h-6 items-center">
                                    <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25" />
                                    <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
                                    <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
                                    <input
                                        type="range"
                                        aria-label="Seek"
                                        min={0}
                                        max={duration || 0}
                                        step={1}
                                        value={time}
                                        onChange={(e) => {
                                            const video = videoRef.current;
                                            if (!video) return;
                                            video.currentTime = Number(e.target.value);
                                            setTime(video.currentTime);
                                            pokeControls();
                                        }}
                                        className="pointer-events-auto absolute inset-x-0 top-1/2 h-1 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                                    />
                                </div>
                            </div>
                        </div>

                        {ended && onNext && (
                            <div className="absolute inset-x-0 top-3 flex justify-center">
                                <Button size="sm" onClick={onNext}>
                                    Next episode <ChevronRight className="size-4" />
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── Choices: below the video in portrait, over its top edge in landscape ── */}
            <div
                className={cn(
                    "flex shrink-0 gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] landscape:absolute landscape:inset-x-0 landscape:top-0 landscape:bg-gradient-to-b landscape:from-black/70 landscape:to-transparent landscape:py-2 landscape:transition-opacity",
                    !showOverlay && "landscape:pointer-events-none landscape:opacity-0"
                )}>
                {chips
                    .filter((c) => c.show)
                    .map((chip) => (
                        <button
                            key={chip.id}
                            type="button"
                            onClick={() => (chip.id === "source" ? openSourcePicker() : setSheet(chip.id))}
                            className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3.5 py-2 text-left active:bg-white/15">
                            <chip.icon className="size-4 text-white/70" />
                            <span className="text-xs text-white/60">{chip.label}</span>
                            <span className="text-sm font-medium">{chip.value}</span>
                        </button>
                    ))}
            </div>
            {src && (
                <p className="shrink-0 px-4 text-xs text-white/40 landscape:hidden">
                    {src === downloadUrl ? "Playing the original file" : `Converted for ${device} by your provider`}
                    {source?.addonName ? ` · ${source.addonName}` : ""}
                </p>
            )}

            {/* Other sources — one tap to switch (portrait; landscape uses the Source chip) */}
            {otherSources.length > 0 && (
                <div className="mt-4 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] landscape:hidden">
                    <div className="flex items-center justify-between px-4 pb-2">
                        <span className="text-xs tracking-widest uppercase text-white/50">Other sources</span>
                        <button type="button" onClick={openSourcePicker} className="text-xs text-primary">
                            See all
                        </button>
                    </div>
                    {otherSources.map((s) => (
                        <button
                            key={s.url}
                            type="button"
                            onClick={() => playAlternativeSource(s)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-white/10">
                            <span
                                className={cn(
                                    "flex size-9 shrink-0 items-center justify-center rounded-md text-[11px] font-medium",
                                    s.isCached ? "bg-primary/15 text-primary" : "bg-white/10 text-white/60"
                                )}>
                                {s.resolution?.replace(/p$/, "") ?? "SD"}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">
                                    {[s.resolution, s.quality].filter(Boolean).join(" ") || "Unknown quality"}
                                    {s.isCached ? <span className="text-primary"> · Cached</span> : null}
                                </span>
                                <span className="block truncate text-xs text-white/45">
                                    {[s.size, s.addonName, s.fileName].filter(Boolean).join(" · ")}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* ── Bottom sheet ── */}
            {sheet && (
                <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50" onClick={() => setSheet(null)}>
                    <div
                        className="max-h-[70%] overflow-y-auto rounded-t-2xl bg-neutral-900 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
                        onClick={(e) => e.stopPropagation()}>
                        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />
                        <p className="px-5 pb-2 text-xs tracking-widest uppercase text-white/50">{chips.find((c) => c.id === sheet)?.label}</p>
                        {sheetOptions.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                onClick={option.onSelect}
                                className={cn(
                                    "flex min-h-12 w-full items-center justify-between px-5 text-left text-[15px] active:bg-white/10",
                                    option.active && "text-primary"
                                )}>
                                {option.label}
                                {option.active && <span className="size-2 rounded-full bg-primary" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
