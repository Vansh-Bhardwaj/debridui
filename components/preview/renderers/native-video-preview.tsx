"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw, SkipBack, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getProxyUrl } from "@/lib/utils";
import { MediaPlayer, type DebridFileNode } from "@/lib/types";
import type { AddonSubtitle } from "@/lib/addons/types";
import { useProgress, type ProgressKey } from "@/hooks/use-progress";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useSettingsStore } from "@/lib/stores/settings";
import { getStreamInfo, type StreamInfo, type StreamVariantOptions } from "@/lib/streaming/stream-info";
import { detectContainer, getDeviceProfile, isMp4Family } from "@/lib/playback/device-profile";
import { isSupportedPlayer, openInPlayer } from "@/lib/utils/media-player";
import {
    decodeSubtitleFileBytes,
    getLanguageDisplayName,
    getSubtitleLabel,
    isSubtitleLanguage,
    parseSubtitleCues,
    type SubtitleCue,
} from "@/lib/utils/subtitles";

/** Cold provider lookups (library listing + createstream) can take ~10s on mobile data. */
const LINKS_WAIT_MS = 30_000;
const SAVE_EVERY_S = 5;
const EXTERNAL_PLAYERS = [MediaPlayer.INFUSE, MediaPlayer.VLC, MediaPlayer.KODI];
const SELECT_CLS =
    "h-9 max-w-[11rem] rounded-md border border-white/10 bg-white/[0.06] px-2 text-sm text-white/90 outline-none focus-visible:ring-2 focus-visible:ring-primary";

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
 * Player route for devices that can only play the provider's transcoded stream
 * (iPhone / iPad). Apple's native <video controls> handles playback, fullscreen,
 * AirPlay and captions; this component only picks the stream and offers the
 * choices native controls can't (audio language, quality, addon subtitles).
 */
export function NativeVideoPreview({ file, downloadUrl, streamingLinks, subtitles, progressKey, onNext, onPrev }: NativeVideoPreviewProps) {
    const device = getDeviceProfile()?.label.split(" · ")[0] ?? "this device";
    const videoRef = useRef<HTMLVideoElement>(null);
    const source = useStreamingStore((s) => s.selectedSource);
    const subtitleLanguage = useSettingsStore((s) => s.settings.playback.subtitleLanguage);
    const { initialProgress, updateProgress, forceSync, markCompleted } = useProgress(progressKey ?? null);

    // streamingLinks is undefined while the provider lookup runs; cap the wait.
    // State is tagged with the URL it belongs to, so a new file starts fresh.
    const [expiredUrl, setExpiredUrl] = useState<string | null>(null);
    useEffect(() => {
        const timer = setTimeout(() => setExpiredUrl(downloadUrl), LINKS_WAIT_MS);
        return () => clearTimeout(timer);
    }, [downloadUrl]);
    const pending = !downloadUrl || (streamingLinks === undefined && expiredUrl !== downloadUrl);

    const [variantState, setVariantState] = useState<{ url: string; info: StreamInfo } | null>(null);
    const variant = variantState?.url === downloadUrl ? variantState.info : null;

    const hlsUrl = variant?.hlsUrl ?? streamingLinks?.apple;
    const info = variant ?? getStreamInfo(hlsUrl);
    const container = detectContainer(source?.fileName, file.name, downloadUrl);
    // Converted stream first. The original only when it's an MP4-family file (or
    // unknown — Safari tries, and a failure lands on the "can't play" screen).
    const src = pending ? null : (hlsUrl ?? (container && !isMp4Family(container) ? null : downloadUrl));

    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const failed = !pending && (!src || failedSrc === src);

    // ── Progress: resume, periodic save, completion ──
    const resumeAtRef = useRef<number | null>(null);
    const lastSavedRef = useRef(0);
    const handleLoadedMetadata = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const switched = resumeAtRef.current != null;
        const at = resumeAtRef.current ?? initialProgress ?? 0;
        resumeAtRef.current = null;
        if (at > 5 && (!video.duration || at < video.duration - 30)) video.currentTime = at;
        // Audio/quality switches keep playing; WebKit allows it once the user has played this element.
        if (switched) void video.play().catch(() => {});
    }, [initialProgress]);
    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video || Math.abs(video.currentTime - lastSavedRef.current) < SAVE_EVERY_S) return;
        lastSavedRef.current = video.currentTime;
        updateProgress(video.currentTime, video.duration);
    }, [updateProgress]);

    // ── Audio language / quality: new provider session at the same position ──
    const [switching, setSwitching] = useState(false);
    const switchVariant = useCallback(async (opts: StreamVariantOptions) => {
        if (!info) return;
        setSwitching(true);
        resumeAtRef.current = videoRef.current?.currentTime ?? null;
        const next = await info.switchVariant(opts).catch(() => null);
        setSwitching(false);
        if (next) setVariantState({ url: downloadUrl, info: next });
        else toast.error("Couldn't switch the stream. Try again in a moment.");
    }, [info, downloadUrl]);

    // ── Addon subtitles → native text track (shows in Apple's player + CC menu) ──
    // null = automatic (preferred language); a number = the user's pick.
    const [chosenSub, setChosenSub] = useState<number | null>(null);
    const subIndex = chosenSub ?? subtitles?.findIndex((s) => !!s.url && isSubtitleLanguage(s, subtitleLanguage)) ?? -1;
    const subUrl = subtitles?.[subIndex]?.url;
    const [loadedCues, setLoadedCues] = useState<{ url: string; cues: SubtitleCue[] } | null>(null);
    const cues = loadedCues && loadedCues.url === subUrl ? loadedCues.cues : null;
    useEffect(() => {
        if (!subUrl) return;
        const controller = new AbortController();
        fetch(getProxyUrl(subUrl), { signal: controller.signal })
            .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
            .then((buf) => setLoadedCues({ url: subUrl, cues: parseSubtitleCues(decodeSubtitleFileBytes(buf)) }))
            .catch(() => {
                if (!controller.signal.aborted) toast.error("Couldn't load those subtitles.");
            });
        return () => controller.abort();
    }, [subUrl]);
    useEffect(() => {
        const video = videoRef.current;
        const sub = subtitles?.[subIndex];
        if (!video || !src || !sub || !cues?.length) return;
        const element = document.createElement("track");
        element.kind = "subtitles";
        element.label = getSubtitleLabel(sub);
        element.srclang = sub.lang || "und";
        video.appendChild(element);
        const track = element.track;
        track.mode = "hidden";
        for (const cue of cues) if (cue.end > cue.start) track.addCue(new VTTCue(cue.start, cue.end, cue.text));
        track.mode = "showing";
        return () => {
            track.mode = "disabled";
            element.remove();
        };
    }, [cues, src, subtitles, subIndex]);

    const tryNextSource = () => {
        if (!useStreamingStore.getState().playNextBestSource()) toast.error("No other sources to try.");
    };
    const externalPlayers = EXTERNAL_PLAYERS.filter((p) => isSupportedPlayer(p));

    return (
        <div className="flex h-full w-full flex-col bg-black text-white">
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
                {pending ? (
                    <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center">
                        <Loader2 className="size-6 animate-spin text-white/60" />
                        <p className="text-sm font-medium">Preparing a stream for {device}</p>
                        <p className="text-xs leading-relaxed text-white/50">
                            {device} plays a converted copy of this file. Starting it can take a few seconds.
                        </p>
                    </div>
                ) : failed ? (
                    <div className="flex max-w-sm flex-col items-center gap-4 px-6 text-center">
                        <AlertCircle className="size-6 text-white/60" />
                        <div className="space-y-1.5">
                            <p className="text-sm font-medium">This file can&apos;t play on {device}</p>
                            <p className="text-xs leading-relaxed text-white/50">
                                {failedSrc === hlsUrl && hlsUrl
                                    ? "The converted stream didn't load."
                                    : `${device} only plays converted streams and MP4 files, and no converted stream is available for this source.`}
                            </p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2">
                            {source && (
                                <Button size="sm" onClick={tryNextSource}>
                                    <RefreshCw className="size-4" /> Try another source
                                </Button>
                            )}
                            {externalPlayers.map((player) => (
                                <Button
                                    key={player}
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                        openInPlayer({ url: downloadUrl, fileName: file.name, player, progressKey })
                                    }>
                                    <ExternalLink className="size-4" /> {player}
                                </Button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <video
                        key={src}
                        ref={videoRef}
                        src={src ?? undefined}
                        controls
                        preload="metadata"
                        className="h-full w-full bg-black object-contain"
                        onLoadedMetadata={handleLoadedMetadata}
                        onTimeUpdate={handleTimeUpdate}
                        onPause={() => forceSync()}
                        onEnded={() => markCompleted()}
                        onError={() => setFailedSrc(src)}
                    />
                )}
                {switching && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <Loader2 className="size-6 animate-spin text-white/70" />
                    </div>
                )}
            </div>

            {/* Choices Apple's controls can't offer. Native <select> → iOS picker. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
                {onPrev && (
                    <Button size="icon" variant="ghost" onClick={onPrev} aria-label="Previous">
                        <SkipBack className="size-4" />
                    </Button>
                )}
                {onNext && (
                    <Button size="icon" variant="ghost" onClick={onNext} aria-label="Next">
                        <SkipForward className="size-4" />
                    </Button>
                )}
                {info && info.audios.length > 1 && (
                    <select
                        aria-label="Audio"
                        className={SELECT_CLS}
                        value={info.audioIndex}
                        disabled={switching}
                        onChange={(e) => void switchVariant({ audioIndex: Number(e.target.value) })}>
                        {info.audios.map((a) => (
                            <option key={a.index} value={a.index}>
                                {[a.language ? getLanguageDisplayName(a.language) : `Track ${a.index + 1}`, a.title, a.channels ? `${a.channels}ch` : null]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </option>
                        ))}
                    </select>
                )}
                {info && info.resolutions.length > 1 && (
                    <select
                        aria-label="Quality"
                        className={SELECT_CLS}
                        value={String(info.resolutionIndex)}
                        disabled={switching}
                        onChange={(e) =>
                            void switchVariant({ resolutionIndex: e.target.value === "null" ? null : Number(e.target.value) })
                        }>
                        {info.resolutions.map((r) => (
                            <option key={String(r.index)} value={String(r.index)}>
                                {r.label}
                            </option>
                        ))}
                    </select>
                )}
                {!!subtitles?.length && (
                    <select
                        aria-label="Subtitles"
                        className={SELECT_CLS}
                        value={subIndex}
                        onChange={(e) => setChosenSub(Number(e.target.value))}>
                        <option value={-1}>Subtitles off</option>
                        {subtitles.map((sub, i) => (
                            <option key={`${sub.url}-${i}`} value={i}>
                                {getSubtitleLabel(sub)}
                            </option>
                        ))}
                    </select>
                )}
                {src && (
                    <span className="ml-auto text-xs tracking-widest uppercase text-white/40">
                        {src === hlsUrl ? `Converted for ${device}` : "Original"}
                    </span>
                )}
            </div>
        </div>
    );
}
