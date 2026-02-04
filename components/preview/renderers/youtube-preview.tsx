"use client";

import { useEffect, useState } from "react";
import { DebridFileNode } from "@/lib/types";
import { Loader2, AlertCircle } from "lucide-react";

interface YouTubePreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

/**
 * YouTube Trailer Renderer
 * Expects downloadUrl to be a YouTube URL (e.g. https://www.youtube.com/watch?v=...)
 */
export function YouTubePreview({ downloadUrl, onLoad, onError }: YouTubePreviewProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const getEmbedUrl = (url: string) => {
        try {
            const urlObj = new URL(url);
            let videoId = "";

            if (urlObj.hostname.includes("youtube.com")) {
                videoId = urlObj.searchParams.get("v") || "";
            } else if (urlObj.hostname.includes("youtu.be")) {
                videoId = urlObj.pathname.slice(1);
            }

            if (!videoId) return null;
            return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
        } catch (e) {
            return null;
        }
    };

    const embedUrl = getEmbedUrl(downloadUrl);

    useEffect(() => {
        if (!embedUrl) {
            setError("Invalid YouTube URL");
            onError?.(new Error("Invalid YouTube URL"));
        }
    }, [embedUrl, onError]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-white bg-black p-4 text-center">
                <AlertCircle className="h-12 w-12 mb-4 text-destructive" />
                <p className="text-lg font-medium">{error}</p>
                <p className="text-sm text-white/60 mt-2">Could not load the trailer.</p>
            </div>
        );
    }

    return (
        <div className="relative w-full h-full bg-black">
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Loader2 className="h-10 w-10 text-white animate-spin" />
                </div>
            )}
            <iframe
                src={embedUrl || ""}
                title="YouTube Video Player"
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                onLoad={() => {
                    setIsLoading(false);
                    onLoad?.();
                }}
            />
        </div>
    );
}
