"use client";

import { useState } from "react";
import { DebridFileNode, MediaPlayer } from "@/lib/types";
import { AlertCircle } from "lucide-react";
import { useSettingsStore } from "@/lib/stores/settings";
import { getProxyUrl, isNonMP4Video } from "@/lib/utils";
import { VideoCodecWarning } from "../video-codec-warning";
import type { AddonSubtitle } from "@/lib/addons/types";

interface VideoPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    /** Optional subtitle tracks (e.g. from Stremio addons) */
    subtitles?: AddonSubtitle[];
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

export function VideoPreview({ file, downloadUrl, subtitles, onLoad, onError }: VideoPreviewProps) {
    const [error, setError] = useState(false);
    const [showCodecWarning, setShowCodecWarning] = useState(true);
    const { set } = useSettingsStore();

    const hasCodecIssue = isNonMP4Video(file.name);

    const handleLoad = () => {
        onLoad?.();
    };

    const handleError = () => {
        setError(true);
        onError?.(new Error("Failed to load video"));
    };

    const switchToPlayer = (player: MediaPlayer) => {
        set("mediaPlayer", player);
        setShowCodecWarning(false);
        // Reload the page to apply the new setting
        window.location.reload();
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
                        src={downloadUrl}
                        controls
                        autoPlay
                        className="w-full h-full object-contain"
                        onLoadedData={handleLoad}
                        onError={handleError}>
                        {/* External subs (addon SRT/VTT) via proxy to avoid CORS. Embedded tracks from the file are exposed automatically by the browser when the container supports them (e.g. some MP4). */}
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

            {/* Codec Warning Banner for Non-MP4 Videos */}
            <VideoCodecWarning
                show={hasCodecIssue && showCodecWarning}
                onClose={() => setShowCodecWarning(false)}
                onSwitchPlayer={switchToPlayer}
            />
        </div>
    );
}
