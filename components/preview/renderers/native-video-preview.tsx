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
    Airplay,
    Maximize,
    Pause,
    PictureInPicture2,
    Play,
    RefreshCw,
    Settings2,
    SkipBack,
    SkipForward,
    Timer,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MediaPlayer, type DebridFileNode } from "@/lib/types";
import type { AddonSubtitle } from "@/lib/addons/types";
import { useProgress, type ProgressKey } from "@/hooks/use-progress";
import { useNextEpisode } from "@/hooks/use-next-episode";
import { useIntroSegments } from "@/hooks/use-intro-segments";
import { useTraktScrobble } from "@/hooks/use-trakt-scrobble";
import { useTraktMedia } from "@/hooks/use-trakt";
import { getPosterUrl } from "@/lib/utils/media";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useSettingsStore } from "@/lib/stores/settings";
import { getStreamInfo, type StreamInfo, type StreamVariantOptions } from "@/lib/streaming/stream-info";
import { detectContainer, getDeviceProfile, isMp4Family } from "@/lib/playback/device-profile";
import { enterNativeFullscreen, type NativeFullscreenVideo } from "@/lib/playback/native-fullscreen";
import { isSupportedPlayer, openInPlayer } from "@/lib/utils/media-player";
import { getLanguageDisplayName, isSubtitleLanguage } from "@/lib/utils/subtitles";
import {
    buildNativeHlsUrl,
    isPlaylistReachable,
    nativeSubtitleNames,
    pickNativeSubtitles,
    signedVttUrl,
    waitForHlsReady,
} from "@/lib/playback/native-hls";
import {
    fitToSpeech,
    formatTiming,
    isIdentity,
    parseCues,
    timingFromHeardLine,
    applyTiming,
    type Cue,
    type SpeechWindow,
    type SubtitleTiming,
} from "@/lib/subtitles/auto-sync";

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
/** Counts as watched past this point (credits), once enough was actually played. */
const COMPLETE_AT = 0.9;
const COMPLETE_MIN_WATCHED = 0.3;

/**
 * Set when an episode ends and the next one is started for the user, so the next
 * player instance resumes playback without a new tap (WebKit allows it while the
 * page still has user activation; otherwise the play button shows as usual).
 */
let continueIntoNext = false;

type StoredTiming = SubtitleTiming & { source: "auto" | "manual" };
const timingKey = (fileName: string, subUrl: string) => `subsync:${fileName}|${subUrl}`;
function loadTiming(fileName: string, subUrl: string): StoredTiming | null {
    try {
        return JSON.parse(localStorage.getItem(timingKey(fileName, subUrl)) ?? "null");
    } catch {
        return null;
    }
}
function saveTiming(fileName: string, subUrl: string, timing: StoredTiming) {
    try {
        localStorage.setItem(timingKey(fileName, subUrl), JSON.stringify(timing));
    } catch { /* storage full / disabled */ }
}

async function loadCues(subUrl: string): Promise<Cue[]> {
    const res = await fetch(await signedVttUrl(subUrl), { signal: AbortSignal.timeout(20_000) });
    return res.ok ? parseCues(await res.text()) : [];
}

/**
 * Speech timeline for auto-sync, from a separate 480p session of the same file and
 * audio track: a few short clips instead of 4K segments keeps the download small.
 */
async function analysisWindows(info: StreamInfo, duration: number, signal: AbortSignal): Promise<SpeechWindow[]> {
    try {
        const low = (info.height ?? Infinity) <= 480 ? info : await info.switchVariant({ resolutionIndex: 3, audioIndex: info.audioIndex });
        if (!low || !(await waitForHlsReady(low.hlsUrl, signal, CONVERT_WAIT_MS))) return [];
        const { readSpeechWindows } = await import("@/lib/subtitles/speech-activity");
        return await readSpeechWindows(low.hlsUrl, duration, signal);
    } catch {
        return [];
    }
}

type WebKitVideo = HTMLVideoElement & {
    webkitShowPlaybackTargetPicker?: () => void;
    webkitSupportsPresentationMode?: (mode: string) => boolean;
    webkitSetPresentationMode?: (mode: string) => void;
    webkitPresentationMode?: string;
    webkitDisplayingFullscreen?: boolean;
    webkitExitFullscreen?: () => void;
};

// Module is client-only (dynamic import, ssr: false).
const PIP_SUPPORTED = !!(document.createElement("video") as WebKitVideo).webkitSupportsPresentationMode?.("picture-in-picture");

/** HLS sessions still being converted can report Infinity; the seekable range is the real length. */
function mediaDuration(video: HTMLVideoElement): number {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    return video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
}

type Sheet = "quality" | "audio" | "subtitles" | "sync" | "speed" | null;

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
    const { scrobble } = useTraktScrobble(progressKey ?? null);
    const nextEpisode = useNextEpisode(progressKey?.imdbId, progressKey?.type, progressKey?.season, progressKey?.episode);
    const { data: segments } = useIntroSegments(progressKey);
    const autoSkipIntro = useSettingsStore((s) => s.settings.playback.autoSkipIntro);
    const autoNextEpisode = useSettingsStore((s) => s.settings.playback.autoNextEpisode);
    const promptSeconds = useSettingsStore((s) => s.settings.playback.nextEpisodePromptSeconds);

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

    // Subtitle step: built into the stream before it starts. Subtitles that arrive after
    // it started (slow addons, long 4K conversions outlast the grace period) are added by
    // swapping in a rebuilt playlist at the same position — otherwise they'd never show.
    const nativeSubs = useMemo(() => pickNativeSubtitles(subtitles, subtitleLanguage), [subtitles, subtitleLanguage]);
    const subsSettled = nativeSubs.length > 0 || subsGraceOver;

    // Subtitle timing (auto-sync or set by hand), remembered per file + subtitle. The
    // proxy retimes the WebVTT, so it applies in Apple's player too.
    const [timingOverrides, setTimingOverrides] = useState<Record<string, StoredTiming>>({});
    const timings = useMemo(() => {
        const all: Record<string, StoredTiming> = {};
        for (const sub of nativeSubs) {
            const t = timingOverrides[sub.url] ?? loadTiming(file.name, sub.url);
            if (t) all[sub.url] = t;
        }
        return all;
    }, [nativeSubs, timingOverrides, file.name]);
    const setTiming = useCallback(
        (subUrl: string, timing: StoredTiming) => {
            saveTiming(file.name, subUrl, timing);
            setTimingOverrides((o) => ({ ...o, [subUrl]: timing }));
        },
        [file.name]
    );
    const timingSig = (subs: AddonSubtitle[]) =>
        subs.map((sub) => (isIdentity(timings[sub.url]) ? "" : `${timings[sub.url].offsetMs}/${timings[sub.url].scale}`)).join("|");

    const [master, setMaster] = useState<{ hls: string; url: string; subs: AddonSubtitle[]; failed?: boolean; sig?: string } | null>(null);
    const masterForStream = master && master.hls === hlsUrl ? master : null;
    /** Resume playback after the element reloads (subtitle or variant swap). */
    const resumeAfterSwapRef = useRef(false);
    const currentSig = timingSig(nativeSubs);
    const needsSubs =
        !masterForStream ||
        (!masterForStream.failed && masterForStream.subs.length === 0 && nativeSubs.length > 0) ||
        (masterForStream.subs.length > 0 && masterForStream.sig !== currentSig);
    // Only once the provider's stream exists: the wrapper fetches that playlist, so
    // checking it during a slow conversion would fail and silently drop subtitles.
    useEffect(() => {
        if (!hlsUrl || !videoReady || !subsSettled || !needsSubs) return;
        let cancelled = false;
        const subs = nativeSubs;
        buildNativeHlsUrl(hlsUrl, subs, subtitleLanguage, timings)
            .then(async (url) => (url === hlsUrl || (await isPlaylistReachable(url)) ? url : null))
            .catch(() => null)
            .then((url) => {
                if (cancelled) return;
                if (!url) {
                    toast.error("Subtitles couldn't be added to this stream.");
                    setMaster((m) => (m?.hls === hlsUrl ? { ...m, failed: true } : { hls: hlsUrl, url: hlsUrl, subs: [], failed: true }));
                    return;
                }
                if (url === hlsUrl && masterForStream) return; // nothing new to add
                const video = videoRef.current;
                resumeAfterSwapRef.current = !!video && !video.paused;
                setMaster({ hls: hlsUrl, url, subs: url === hlsUrl ? [] : subs, sig: currentSig });
            });
        return () => {
            cancelled = true;
        };
    }, [hlsUrl, videoReady, subsSettled, needsSubs, masterForStream, nativeSubs, subtitleLanguage, timings, currentSig]);

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
            state: !videoReady ? "waiting" : masterForStream ? "done" : "active",
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

    // ── Watch tracking: history, Trakt, completion (advances Continue Watching) ──
    const [historySession] = useState(() => crypto.randomUUID());
    const watchedRef = useRef(0);
    const completedRef = useRef(false);
    const sendHistory = useCallback(
        (eventType: "pause" | "stop" | "complete") => {
            const video = videoRef.current;
            const dur = video ? mediaDuration(video) : 0;
            if (!progressKey || !video || !dur || video.currentTime < 10) return;
            fetch("/api/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...progressKey,
                    fileName: file.name,
                    progressSeconds: Math.round(video.currentTime),
                    durationSeconds: Math.round(dur),
                    eventType,
                    sessionId: historySession,
                }),
                keepalive: eventType !== "pause",
            }).catch(() => {});
        },
        [progressKey, file.name, historySession]
    );
    const complete = useCallback(() => {
        if (completedRef.current || !progressKey) return;
        completedRef.current = true;
        void scrobble("stop", 100);
        sendHistory("complete");
        // Seeds the next episode so Continue Watching moves on instead of falling back to an older one.
        markCompleted(nextEpisode ?? undefined);
    }, [progressKey, scrobble, sendHistory, markCompleted, nextEpisode]);

    // Leaving mid-episode: final history + Trakt stop (progress itself is flushed by useProgress).
    const leaveRef = useRef(() => {});
    useEffect(() => {
        leaveRef.current = () => {
            const video = videoRef.current;
            const dur = video ? mediaDuration(video) : 0;
            if (completedRef.current || !video || !dur || video.currentTime < 10) return;
            sendHistory("stop");
            void scrobble("stop", (video.currentTime / dur) * 100);
        };
    }, [sendHistory, scrobble]);
    useEffect(() => () => leaveRef.current(), []);

    const handleLoadedMetadata = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const dur = mediaDuration(video);
        setDuration(dur);
        const at = positionRef.current > 1 ? positionRef.current : (initialProgress ?? 0);
        if (at > 5 && (!dur || at < dur - 30)) video.currentTime = at;
        video.playbackRate = speed;
        // WebKit allows play() without a new tap once the user has played this element.
        if (wasPlayingRef.current || resumeAfterSwapRef.current || continueIntoNext) {
            continueIntoNext = false;
            resumeAfterSwapRef.current = false;
            setBuffering(true);
            void video.play().catch(() => setBuffering(false));
        }
    }, [initialProgress, speed]);

    // Intro/recap skip (IntroDB) and the up-next countdown before the credits.
    const skippedRef = useRef(new Set<string>());
    const [skipSegment, setSkipSegment] = useState<"intro" | "recap" | null>(null);
    const [upNextIn, setUpNextIn] = useState<number | null>(null);
    const upNextDismissedRef = useRef(false);
    const advancedRef = useRef(false);
    const playNextRef = useRef(() => {});
    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const t = video.currentTime;
        const delta = t - positionRef.current;
        // Only real playback counts as watched (not seeking to the end).
        if (!video.paused && delta > 0 && delta < 2) watchedRef.current += delta;
        positionRef.current = t;
        setTime(t);
        const dur = mediaDuration(video);
        if (dur && dur !== duration) setDuration(dur);
        if (video.buffered.length) setBufferedEnd(video.buffered.end(video.buffered.length - 1));
        if (Math.abs(t - lastSavedRef.current) >= SAVE_EVERY_S) {
            lastSavedRef.current = t;
            updateProgress(t, dur);
            if ("mediaSession" in navigator && dur) {
                try {
                    navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(t, dur), playbackRate: video.playbackRate });
                } catch { /* unsupported */ }
            }
        }
        if (!dur) return;
        if (t / dur >= COMPLETE_AT && watchedRef.current >= dur * COMPLETE_MIN_WATCHED) complete();

        const active = (["intro", "recap"] as const).find((type) => {
            const seg = segments?.[type];
            return seg && t >= seg.start_sec && t < seg.end_sec - 1;
        });
        if (active && autoSkipIntro && !skippedRef.current.has(active)) {
            skippedRef.current.add(active);
            video.currentTime = segments![active]!.end_sec;
        }
        setSkipSegment(active && !autoSkipIntro ? active : null);

        // Counts down from the credits (IntroDB outro, else the last N seconds), then moves on.
        if (onNext && autoNextEpisode && !upNextDismissedRef.current) {
            const lead = Math.max(5, Math.min(promptSeconds || 10, 30));
            const outro = segments?.outro?.start_sec;
            const startAt = Math.min(dur - lead, outro != null && outro > dur * 0.8 ? outro : Infinity);
            const remaining = Math.min(dur, startAt + lead) - t;
            if (t < startAt) setUpNextIn(null);
            else if (remaining > 0) setUpNextIn(Math.ceil(remaining));
            else playNextRef.current();
        }
    }, [updateProgress, duration, complete, segments, autoSkipIntro, onNext, autoNextEpisode, promptSeconds]);

    const playNext = useCallback(() => {
        if (!onNext || advancedRef.current) return;
        advancedRef.current = true;
        const v = videoRef.current;
        const dur = v ? mediaDuration(v) : 0;
        // Into the credits counts as watched; skipping ahead early doesn't.
        if (v && dur && v.currentTime / dur >= 0.8) complete();
        setUpNextIn(null);
        continueIntoNext = true;
        // The next episode is a new element; Apple's fullscreen player can't carry over.
        const video = videoRef.current as WebKitVideo | null;
        if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
        onNext();
    }, [onNext, complete]);
    useEffect(() => {
        playNextRef.current = playNext;
    }, [playNext]);

    // ── Apple integration: Now Playing (lock screen, Control Center, AirPods),
    // AirPlay, Picture in Picture, and Apple's fullscreen player lifecycle ──
    const seekByRef = useRef<(delta: number) => void>(() => {});
    const [airplayAvailable, setAirplayAvailable] = useState(false);
    useEffect(() => {
        const video = videoRef.current as WebKitVideo | null;
        if (!video || !src) return;
        video.setAttribute("autopictureinpicture", "");
        const onTargets = (e: Event) => setAirplayAvailable((e as Event & { availability?: string }).availability === "available");
        // Apple's player has no hooks of its own: save on the way out of it.
        const onEndFullscreen = () => forceSync();
        video.addEventListener("webkitplaybacktargetavailabilitychanged", onTargets);
        video.addEventListener("webkitendfullscreen", onEndFullscreen);
        return () => {
            video.removeEventListener("webkitplaybacktargetavailabilitychanged", onTargets);
            video.removeEventListener("webkitendfullscreen", onEndFullscreen);
        };
    }, [src, forceSync]);

    // Now Playing (lock screen / Control Center): show + episode, poster as artwork.
    // iOS resets it whenever the stream (re)loads, so it is re-applied on every play.
    const { data: media } = useTraktMedia(progressKey?.imdbId ?? "", progressKey?.type ?? "movie");
    const nowPlayingRef = useRef(() => {});
    useEffect(() => {
        nowPlayingRef.current = () => {
            if (!("mediaSession" in navigator)) return;
            const episode = progressKey?.type === "show" && progressKey.season != null
                ? `S${progressKey.season} E${progressKey.episode}`
                : null;
            const name = file.name.replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\.(mkv|mp4|m4v|avi|mov|webm|ts)$/i, "");
            const poster = getPosterUrl(media?.images)
                ?? (progressKey?.imdbId.startsWith("tt") ? `https://images.metahub.space/poster/medium/${progressKey.imdbId}/img` : null);
            navigator.mediaSession.metadata = new MediaMetadata({
                title: name,
                artist: [media?.title, episode].filter(Boolean).join(" · ") || "DebridUI",
                album: "DebridUI",
                artwork: poster ? [{ src: poster, sizes: "512x768", type: "image/jpeg" }] : [],
            });
        };
        if (src) nowPlayingRef.current();
    }, [src, file.name, media, progressKey]);
    useEffect(() => {
        if (!src || !("mediaSession" in navigator)) return;
        const session = navigator.mediaSession;
        const video = () => videoRef.current;
        const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
            ["play", () => void video()?.play()],
            ["pause", () => video()?.pause()],
            ["seekbackward", (d) => seekByRef.current(-(d.seekOffset ?? 10))],
            ["seekforward", (d) => seekByRef.current(d.seekOffset ?? 10)],
            ["seekto", (d) => {
                const v = video();
                if (v && d.seekTime != null) v.currentTime = d.seekTime;
            }],
            ["previoustrack", onPrev ? () => onPrev() : null],
            ["nexttrack", onNext ? () => playNextRef.current() : null],
        ];
        for (const [action, handler] of handlers) {
            try {
                session.setActionHandler(action, handler);
            } catch { /* action not supported */ }
        }
        return () => {
            for (const [action] of handlers) {
                try {
                    session.setActionHandler(action, null);
                } catch { /* ignore */ }
            }
            session.metadata = null;
        };
    }, [src, onPrev, onNext]);

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

    // ── Subtitle sync: automatic (audio) and by hand ("the line I just heard") ──
    const subtitleAutoSync = useSettingsStore((s) => s.settings.playback.subtitleAutoSync);
    const syncSubs = masterForStream?.subs;
    const syncNames = useMemo(() => nativeSubtitleNames(syncSubs ?? []), [syncSubs]);
    const activeLabel = textTracks.find((t) => t.index === activeTrack)?.label.trim();
    const activeSub = activeLabel ? syncSubs?.[syncNames.indexOf(activeLabel)] : undefined;
    const activeTiming: SubtitleTiming = (activeSub && timings[activeSub.url]) || { offsetMs: 0, scale: 1 };

    const lifetimeRef = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        lifetimeRef.current = controller;
        return () => controller.abort();
    }, []);
    const speechRef = useRef<Promise<SpeechWindow[]> | null>(null);
    const autoCheckedRef = useRef(new Set<string>());
    useEffect(() => {
        const signal = lifetimeRef.current?.signal;
        // After playback starts, so the analysis never competes with startup.
        if (!signal || !subtitleAutoSync || !playing || !info || !duration || !syncSubs?.length) return;
        const pending = syncSubs.filter((sub) => !timings[sub.url] && !autoCheckedRef.current.has(sub.url)).slice(0, 4);
        if (pending.length === 0) return;
        pending.forEach((sub) => autoCheckedRef.current.add(sub.url));
        speechRef.current ??= analysisWindows(info, duration, signal);
        void (async () => {
            const windows = await speechRef.current!;
            if (windows.length === 0) return;
            const fits: [string, SubtitleTiming][] = [];
            for (const sub of pending) {
                const cues = await loadCues(sub.url).catch(() => []);
                await new Promise((resolve) => setTimeout(resolve, 0)); // keep the UI responsive between fits
                const fit = fitToSpeech(cues, windows);
                if (fit) fits.push([sub.url, fit]);
            }
            if (signal.aborted) return;
            // One state update, so one stream reload for all fitted subtitles.
            fits.forEach(([url, fit]) => setTiming(url, { offsetMs: fit.offsetMs, scale: fit.scale, source: "auto" }));
            const changed = fits.find(([, fit]) => !isIdentity(fit));
            if (changed) toast.success(`Subtitles synced to the audio (${formatTiming(changed[1])})`);
        })();
    }, [subtitleAutoSync, playing, info, duration, syncSubs, timings, setTiming]);

    const [heardCues, setHeardCues] = useState<{ url: string; cues: Cue[] } | null>(null);
    useEffect(() => {
        if (sheet !== "sync" || !activeSub || heardCues?.url === activeSub.url) return;
        let cancelled = false;
        void loadCues(activeSub.url)
            .catch(() => [])
            .then((cues) => {
                if (!cancelled) setHeardCues({ url: activeSub.url, cues });
            });
        return () => {
            cancelled = true;
        };
    }, [sheet, activeSub, heardCues?.url]);
    const [draftOffsetMs, setDraftOffsetMs] = useState<number | null>(null);
    const applyTimingToActive = (timing: SubtitleTiming) => {
        if (!activeSub) return;
        setTiming(activeSub.url, { ...timing, source: "manual" });
        setDraftOffsetMs(null);
        setSheet(null);
        toast.success(`Subtitle timing: ${formatTiming(timing)}`);
    };
    const recentLines = (heardCues?.url === activeSub?.url ? (heardCues?.cues ?? []) : [])
        .filter((cue) => {
            const shown = applyTiming(cue.start, activeTiming);
            return shown <= time + 2 && shown >= time - 25;
        })
        .slice(-8);

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
    useEffect(() => {
        seekByRef.current = seekBy;
    }, [seekBy]);

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
            const url = await buildNativeHlsUrl(next.hlsUrl, subs, subtitleLanguage, timings).catch(() => next.hlsUrl);
            resumeAfterSwapRef.current = !videoRef.current?.paused;
            setVideoCheck({ url: next.hlsUrl, ok: true });
            setMaster({ hls: next.hlsUrl, url, subs: url === next.hlsUrl ? [] : subs, sig: master?.sig });
            setVariant(next);
            setSwitching(false);
        },
        [info, master, subtitleLanguage, timings]
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
        { id: "sync", icon: Timer, label: "Sync", value: formatTiming(activeTiming), show: !!activeSub },
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
                            x-webkit-airplay="allow"
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
                                nowPlayingRef.current();
                                const v = videoRef.current;
                                const dur = v ? mediaDuration(v) : 0;
                                if (v && dur) void scrobble("start", (v.currentTime / dur) * 100);
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
                                const v = videoRef.current;
                                const dur = v ? mediaDuration(v) : 0;
                                if (v && dur && !v.ended) {
                                    void scrobble("pause", (v.currentTime / dur) * 100);
                                    sendHistory("pause");
                                }
                            }}
                            onEnded={() => {
                                setEnded(true);
                                complete();
                                if (onNext && autoNextEpisode && !upNextDismissedRef.current) playNext();
                            }}
                            onError={() => {
                                setBuffering(false);
                                // Subtitle wrapper failed → play the provider stream without it.
                                if (masterForStream && src === masterForStream.url && src !== hlsUrl) {
                                    setMaster({ ...masterForStream, url: masterForStream.hls, subs: [], failed: true });
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
                                    onClick={playNext}
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
                                    <span className="flex items-center">
                                        {airplayAvailable && (
                                            <button
                                                type="button"
                                                aria-label="AirPlay"
                                                onClick={() => (videoRef.current as WebKitVideo | null)?.webkitShowPlaybackTargetPicker?.()}
                                                className="pointer-events-auto p-2">
                                                <Airplay className="size-5" />
                                            </button>
                                        )}
                                        {PIP_SUPPORTED && (
                                            <button
                                                type="button"
                                                aria-label="Picture in Picture"
                                                onClick={() => {
                                                    const video = videoRef.current as WebKitVideo | null;
                                                    video?.webkitSetPresentationMode?.(
                                                        video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture"
                                                    );
                                                }}
                                                className="pointer-events-auto p-2">
                                                <PictureInPicture2 className="size-5" />
                                            </button>
                                        )}
                                        <button type="button" aria-label="Fullscreen" onClick={goFullscreen} className="pointer-events-auto p-2">
                                            <Maximize className="size-5" />
                                        </button>
                                    </span>
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

                        {/* Bottom-right above the scrubber: clear of the landscape chip row at the top. */}
                        {(skipSegment || (onNext && (ended || upNextIn !== null))) && (
                            <div className="absolute right-3 bottom-16 z-10 flex items-center gap-2">
                                {skipSegment ? (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                            const seg = segments?.[skipSegment];
                                            if (seg && videoRef.current) videoRef.current.currentTime = seg.end_sec;
                                            skippedRef.current.add(skipSegment);
                                            setSkipSegment(null);
                                        }}>
                                        Skip {skipSegment}
                                    </Button>
                                ) : (
                                    <>
                                        {upNextIn !== null && !ended && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-white/70"
                                                onClick={() => {
                                                    upNextDismissedRef.current = true;
                                                    setUpNextIn(null);
                                                }}>
                                                Cancel
                                            </Button>
                                        )}
                                        <Button size="sm" onClick={playNext}>
                                            {nextEpisode ? `S${nextEpisode.season} E${nextEpisode.episode}` : "Next episode"}
                                            {upNextIn !== null && !ended ? ` in ${upNextIn}s` : ""}
                                            <ChevronRight className="size-4" />
                                        </Button>
                                    </>
                                )}
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
                        {sheet === "sync" && activeSub && (
                            <div className="space-y-3 px-5 pb-2">
                                <p className="text-sm text-white/70">
                                    {formatTiming(activeTiming)}
                                    {timings[activeSub.url]?.source === "auto" && !isIdentity(activeTiming) ? " · matched to the audio" : ""}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                    {[-500, 500].map((step) => (
                                        <Button
                                            key={step}
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setDraftOffsetMs((d) => (d ?? activeTiming.offsetMs) + step)}>
                                            {step < 0 ? "Earlier 0.5s" : "Later 0.5s"}
                                        </Button>
                                    ))}
                                    {draftOffsetMs !== null && draftOffsetMs !== activeTiming.offsetMs ? (
                                        <Button size="sm" onClick={() => applyTimingToActive({ ...activeTiming, offsetMs: draftOffsetMs })}>
                                            Apply {formatTiming({ ...activeTiming, offsetMs: draftOffsetMs })}
                                        </Button>
                                    ) : (
                                        !isIdentity(activeTiming) && (
                                            <Button size="sm" variant="ghost" onClick={() => applyTimingToActive({ offsetMs: 0, scale: 1 })}>
                                                Reset
                                            </Button>
                                        )
                                    )}
                                </div>
                                <p className="pt-1 text-xs tracking-widest uppercase text-white/50">Tap the line you just heard</p>
                                {heardCues?.url !== activeSub.url ? (
                                    <Loader2 className="size-4 animate-spin text-white/60" />
                                ) : recentLines.length === 0 ? (
                                    <p className="text-sm text-white/50">Play a little dialogue, then come back here.</p>
                                ) : (
                                    recentLines.map((cue) => (
                                        <button
                                            key={`${cue.start}-${cue.text}`}
                                            type="button"
                                            onClick={() =>
                                                applyTimingToActive(timingFromHeardLine(cue, videoRef.current?.currentTime ?? time, activeTiming))
                                            }
                                            className="block w-full rounded-md bg-white/[0.06] px-3 py-2 text-left text-sm active:bg-white/15">
                                            {cue.text}
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
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
