"use client";

import { useRef, useState } from "react";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { AlertCircle } from "lucide-react";
import { getProxyUrl, isNonMP4Video, openInPlayer } from "@/lib/utils";
import { VideoCodecWarning } from "../video-codec-warning";
import type { AddonSubtitle } from "@/lib/addons/types";

export interface LegacyVideoPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    subtitles?: AddonSubtitle[];
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

/** Native HTML5 video player. Used as fallback when Video.js v10 is disabled or fails. */
export function LegacyVideoPreview({ file, downloadUrl, subtitles, onLoad, onError }: LegacyVideoPreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState(false);
    const [showCodecWarning, setShowCodecWarning] = useState(true);

    const hasCodecIssue = isNonMP4Video(file.name);

    const handleLoad = () => {
        onLoad?.();
    };

    const handleError = () => {
        setError(true);
        onError?.(new Error("Failed to load video"));
    };

    const openInExternalPlayer = (player: MediaPlayer) => {
        videoRef.current?.pause();
        openInPlayer({ url: downloadUrl, fileName: file.name, player });
        setShowCodecWarning(false);
    };

    return (
        <div className="relative w-full h-full flex flex-col bg-black">
            {error ? (
                <div className="flex-1 flex flex-col items-center justify-center text-white">
                    <AlertCircle className="h-12 w-12 mb-2" />
                    <p className="text-sm">Failed to load video</p>
                    <p className="text-xs text-white/70 mt-1">{file.name}</p>
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center overflow-hidden">
                    <video
                        ref={videoRef}
                        src={downloadUrl}
                        controls
                        autoPlay
                        className="w-full h-full object-contain"
                        onLoadedData={handleLoad}
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
                    </video>
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
