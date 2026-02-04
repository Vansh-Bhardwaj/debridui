"use client";

import { Component, type ReactNode } from "react";
import { LegacyVideoPreview } from "./legacy-video-preview";
import type { AddonSubtitle } from "@/lib/addons/types";
import { DebridFileNode } from "@/lib/types";

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
export function VideoPreview({ file, downloadUrl, streamingLinks, subtitles, onLoad, onError }: VideoPreviewProps) {
    const legacy = (
        <LegacyVideoPreview
            file={file}
            downloadUrl={downloadUrl}
            streamingLinks={streamingLinks}
            subtitles={subtitles}
            onLoad={onLoad}
            onError={onError}
        />
    );

    return <VideoPreviewErrorBoundary fallback={legacy}>{legacy}</VideoPreviewErrorBoundary>;
}
