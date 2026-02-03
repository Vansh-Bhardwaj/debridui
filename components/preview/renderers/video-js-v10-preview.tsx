"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { AlertCircle } from "lucide-react";
import { getProxyUrl, isNonMP4Video, openInPlayer } from "@/lib/utils";
import { VideoCodecWarning } from "../video-codec-warning";
import type { AddonSubtitle } from "@/lib/addons/types";
import { VideoProvider, Video, MediaContainer, MinimalSkin } from "@videojs/react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import "@videojs/react/skins/minimal.css";

/** HTMLMediaElement with optional audioTracks (not in all TS lib.dom versions). */
interface MediaElementWithAudioTracks extends HTMLVideoElement {
    audioTracks?: { length: number; [i: number]: { enabled: boolean } };
}

export interface VideoJsV10PreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    subtitles?: AddonSubtitle[];
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

/** Video element ref with media track APIs (audioTracks is on HTMLMediaElement). */
type MediaElementRef = React.RefObject<HTMLVideoElement | null>;

/** Subtitle and audio track controls for v10 player; uses native video ref. */
function PlayerTrackControls({
    videoRef,
    subtitles,
    audioTrackCount,
}: {
    videoRef: MediaElementRef;
    subtitles?: AddonSubtitle[];
    audioTrackCount: number;
}) {
    const [selectedSubIndex, setSelectedSubIndex] = useState(-1);
    const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);

    useEffect(() => {
        const el = videoRef.current;
        if (!el?.textTracks) return;
        const tracks = el.textTracks;
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = selectedSubIndex === i ? "showing" : "disabled";
        }
    }, [selectedSubIndex, videoRef]);

    useEffect(() => {
        const el = videoRef.current as MediaElementWithAudioTracks | null;
        if (!el?.audioTracks) return;
        const tracks = el.audioTracks;
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = selectedAudioIndex === i;
        }
    }, [selectedAudioIndex, videoRef, audioTrackCount]);

    const showSubs = (subtitles?.length ?? 0) > 0;
    const showAudio = audioTrackCount > 1;

    if (!showSubs && !showAudio) return null;

    return (
        <div className="vjs:absolute vjs:bottom-0 vjs:right-0 vjs:flex vjs:items-center vjs:gap-1.5 vjs:z-20 vjs:pb-3 vjs:pr-14 vjs:pointer-events-auto">
            {showSubs && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-white hover:bg-white/20 hover:text-white rounded-md">
                            <span className="text-xs font-medium">CC</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[140px]">
                        <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground">
                            Subtitles
                        </DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setSelectedSubIndex(-1)}>
                            Off
                        </DropdownMenuItem>
                        {subtitles!.map((sub, i) => (
                            <DropdownMenuItem
                                key={`${sub.lang}-${sub.url}-${i}`}
                                onClick={() => setSelectedSubIndex(i)}>
                                {sub.name ?? sub.lang}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            {showAudio && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-white hover:bg-white/20 hover:text-white rounded-md">
                            <span className="text-xs font-medium">Audio</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[140px]">
                        <DropdownMenuLabel className="text-xs tracking-widest uppercase text-muted-foreground">
                            Audio track
                        </DropdownMenuLabel>
                        {Array.from({ length: audioTrackCount }, (_, i) => (
                            <DropdownMenuItem key={i} onClick={() => setSelectedAudioIndex(i)}>
                                Track {i + 1}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

/** Video.js v10 player (alpha). Used when videoPreviewEngine is "v10". */
export function VideoJsV10Preview({ file, downloadUrl, subtitles, onLoad, onError }: VideoJsV10PreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState(false);
    const [showCodecWarning, setShowCodecWarning] = useState(true);
    const [audioTrackCount, setAudioTrackCount] = useState(0);
    const hasCodecIssue = isNonMP4Video(file.name);

    const handleLoadedData = useCallback(() => {
        onLoad?.();
    }, [onLoad]);

    const handleLoadedMetadata = useCallback(() => {
        const el = videoRef.current as MediaElementWithAudioTracks | null;
        if (el?.audioTracks) setAudioTrackCount(el.audioTracks.length);
    }, []);

    const handleError = useCallback(() => {
        setError(true);
        onError?.(new Error("Failed to load video"));
    }, [onError]);

    const openInExternalPlayer = useCallback(
        (player: MediaPlayer) => {
            videoRef.current?.pause();
            setShowCodecWarning(false);
            openInPlayer({ url: downloadUrl, fileName: file.name, player });
        },
        [downloadUrl, file.name]
    );

    if (error) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-white bg-black">
                <AlertCircle className="h-12 w-12 mb-2" />
                <p className="text-sm">Failed to load video</p>
                <p className="text-xs text-white/70 mt-1">{file.name}</p>
            </div>
        );
    }

    return (
        <div className="relative w-full h-full flex flex-col bg-black">
            <VideoProvider>
                <MediaContainer className="flex-1 flex flex-col min-h-0 w-full">
                    <MinimalSkin className="flex-1 flex flex-col min-h-0 w-full">
                        <Video
                            ref={videoRef}
                            src={downloadUrl}
                            autoPlay
                            className="w-full h-full object-contain"
                            onLoadedData={handleLoadedData}
                            onLoadedMetadata={handleLoadedMetadata}
                            onError={handleError}>
                            {subtitles?.map((sub, i) => (
                                <track
                                    key={`${sub.lang}-${sub.url}-${i}`}
                                    kind="subtitles"
                                    src={getProxyUrl(sub.url)}
                                    srcLang={sub.lang}
                                    label={sub.name ?? sub.lang}
                                    default={i === 0}
                                />
                            ))}
                        </Video>
                    </MinimalSkin>
                    <PlayerTrackControls
                        videoRef={videoRef}
                        subtitles={subtitles}
                        audioTrackCount={audioTrackCount}
                    />
                </MediaContainer>
            </VideoProvider>

            <VideoCodecWarning
                show={hasCodecIssue && showCodecWarning}
                onClose={() => setShowCodecWarning(false)}
                onOpenInPlayer={openInExternalPlayer}
            />
        </div>
    );
}
