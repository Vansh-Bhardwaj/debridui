"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { AlertCircle, Play } from "lucide-react";
import { getProxyUrl, isNonMP4Video, openInPlayer } from "@/lib/utils";
import { VideoCodecWarning } from "../video-codec-warning";
import type { AddonSubtitle } from "@/lib/addons/types";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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
    subtitles?: AddonSubtitle[];
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

const LOADING_HINT_AFTER_MS = 12000;

/** Native HTML5 video player. iOS: tap-to-play (no autoplay), loading timeout hint. Windows: unchanged. */
export function LegacyVideoPreview({ file, downloadUrl, subtitles, onLoad, onError }: LegacyVideoPreviewProps) {
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

    const hasCodecIssue = isNonMP4Video(file.name);

    const [iosDidStartPlayback, setIosDidStartPlayback] = useState(false);

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
        onError?.(new Error("Failed to load video"));
    }, [onError]);

    const handleLoadedMetadata = useCallback(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number; [i: number]: { enabled: boolean; label?: string; language?: string } };
        }) | null;
        if (el?.audioTracks) setAudioTrackCount(el.audioTracks.length);
    }, []);

    useEffect(() => {
        const el = videoRef.current as (HTMLVideoElement & {
            audioTracks?: { length: number; [i: number]: { enabled: boolean } };
        }) | null;
        if (!el?.audioTracks) return;
        const tracks = el.audioTracks;
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = selectedAudioIndex === i;
        }
    }, [selectedAudioIndex, audioTrackCount]);

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

    // iOS: load addon subtitles into native TextTracks (Safari is unreliable with <track> + .srt URLs)
    useEffect(() => {
        const el = videoRef.current;
        if (!ios || !iosDidStartPlayback || !el || !subtitles?.length) return;

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

        const addCuesFromSrtOrVtt = (track: TextTrack, text: string) => {
            const raw = text.replace(/\r\n/g, "\n").trim();
            const body = raw.startsWith("WEBVTT") ? raw.replace(/^WEBVTT[^\n]*\n+/, "") : raw;
            const blocks = body.split(/\n{2,}/);

            for (const block of blocks) {
                const lines = block.split("\n").filter(Boolean);
                if (lines.length < 2) continue;

                // SRT: optional numeric index line
                const timeLineIdx = /^\d+$/.test(lines[0]!) ? 1 : 0;
                const timeLine = lines[timeLineIdx];
                if (!timeLine?.includes("-->")) continue;

                const [startRaw, endRaw] = timeLine.split("-->").map((p) => p.trim());
                const start = parseTime(startRaw);
                const end = parseTime(endRaw.split(/\s+/)[0] ?? "");
                if (start == null || end == null) continue;

                const cueText = lines.slice(timeLineIdx + 1).join("\n");
                try {
                    track.addCue(new VTTCue(start, end, cueText));
                } catch {
                    // ignore malformed cues
                }
            }
        };

        const run = async () => {
            // Clear previously-added subtitle tracks (keep any existing "metadata" tracks if present)
            const existing = Array.from(el.textTracks ?? []).filter((t) => t.kind === "subtitles" || t.kind === "captions");
            for (const t of existing) t.mode = "disabled";

            for (const sub of subtitles) {
                if (!sub.url || !sub.lang) continue;
                const label = sub.name ?? sub.lang;
                const tt = el.addTextTrack("subtitles", label, sub.lang);
                tt.mode = "disabled";

                try {
                    const res = await fetch(getProxyUrl(sub.url), { signal: controller.signal });
                    if (!res.ok) continue;
                    const txt = await res.text();
                    addCuesFromSrtOrVtt(tt, txt);
                } catch {
                    // ignore fetch/parse errors per-track
                }
            }
        };

        void run();
        return () => controller.abort();
    }, [ios, iosDidStartPlayback, subtitles]);

    const openInExternalPlayer = useCallback(
        (player: MediaPlayer) => {
            videoRef.current?.pause();
            openInPlayer({ url: downloadUrl, fileName: file.name, player });
            setShowCodecWarning(false);
            setShowLoadingHint(false);
        },
        [downloadUrl, file.name]
    );

    // iOS: ensure playsinline (and webkit prefix for older Safari)
    useEffect(() => {
        const el = videoRef.current;
        if (el) el.setAttribute("webkit-playsinline", "true");
    }, []);

    return (
        <div className="relative w-full h-full flex flex-col bg-black">
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
                        src={canStartPlayback ? downloadUrl : undefined}
                        controls
                        autoPlay={!ios && canStartPlayback}
                        playsInline
                        preload={ios ? "none" : "metadata"}
                        className="w-full h-full object-contain bg-black"
                        style={{ maxHeight: "100%" }}
                        onLoadedMetadata={handleLoadedMetadata}
                        onLoadedData={handleLoad}
                        onError={handleError}>
                        {!ios &&
                            subtitles?.map((sub, i) => (
                                <track
                                    key={`${sub.lang}-${sub.url}-${i}`}
                                    kind="subtitles"
                                    src={getProxyUrl(sub.url)}
                                    srcLang={sub.lang}
                                    label={sub.name ?? sub.lang}
                                    default={i === 0}
                                />
                            ))}
                    </video>

                    {/* Non-iOS: brief "preparing subtitles" gate (proxy conversion) */}
                    {!ios && !canStartPlayback && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm z-10">
                            Preparing subtitles…
                        </div>
                    )}

                    {/* Audio track selector (custom labels); avoids relying on browser-native naming/menus */}
                    {!ios && audioTrackCount > 1 && (
                        <div className="absolute bottom-4 right-4 z-10">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="bg-black/60 text-white hover:bg-black/70 border border-white/10">
                                        Audio
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[180px]">
                                    <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground">
                                        Audio track
                                    </DropdownMenuLabel>
                                    {Array.from({ length: audioTrackCount }, (_, i) => {
                                        const el = videoRef.current as (HTMLVideoElement & {
                                            audioTracks?: {
                                                length: number;
                                                [i: number]: { enabled: boolean; label?: string; language?: string };
                                            };
                                        }) | null;
                                        const t = el?.audioTracks?.[i];
                                        const langLabel = t?.language ? getLanguageDisplayName(t.language) : "";
                                        const base = (t?.label ?? "").trim();
                                        const label = [langLabel, base].filter(Boolean).join(" · ") || `Track ${i + 1}`;
                                        return (
                                            <DropdownMenuItem key={i} onClick={() => setSelectedAudioIndex(i)}>
                                                {label}
                                            </DropdownMenuItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
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

            <VideoCodecWarning
                show={hasCodecIssue && showCodecWarning}
                onClose={() => setShowCodecWarning(false)}
                onOpenInPlayer={openInExternalPlayer}
            />
        </div>
    );
}
