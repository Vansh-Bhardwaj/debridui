"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";


// Lazy load the legacy player to reduce bundle size
const LegacyVideoPreview = dynamic(
    () => import("./legacy-video-preview").then((mod) => mod.LegacyVideoPreview),
    {
        ssr: false,
        loading: () => (
            <div className="h-full w-full flex items-center justify-center bg-black/50 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        ),
    }
);
import type { AddonSubtitle } from "@/lib/addons/types";
import { DebridFileNode } from "@/lib/types";
import { type ProgressKey } from "@/hooks/use-progress";

interface VideoPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    streamingLinks?: Record<string, string>;
    subtitles?: AddonSubtitle[];
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

/** Error boundary: on error renders fallback instead of crashing. */
class VideoPreviewErrorBoundary extends Component<
    { fallback: ReactNode; children: ReactNode },
    { hasError: boolean }
> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback;
        }
        return this.props.children;
    }
}

/** Picks Video.js v10 or legacy native player from settings. Falls back to legacy on error. */
export function VideoPreview({ file, downloadUrl, streamingLinks, subtitles, progressKey, onNext, onPrev, onPreload, onLoad, onError }: VideoPreviewProps & { onNext?: () => void; onPrev?: () => void; onPreload?: () => void; progressKey?: ProgressKey }) {
    const legacy = (
        <LegacyVideoPreview
            file={file}
            downloadUrl={downloadUrl}
            streamingLinks={streamingLinks}
            subtitles={subtitles}
            progressKey={progressKey}
            onNext={onNext}
            onPrev={onPrev}
            onPreload={onPreload}
            onLoad={onLoad}
            onError={onError}
        />
    );

    return <VideoPreviewErrorBoundary fallback={legacy}>{legacy}</VideoPreviewErrorBoundary>;
}
