"use client";

import { Component, type ReactNode } from "react";
import { useSettingsStore } from "@/lib/stores/settings";
import type { VideoPreviewEngine } from "@/lib/stores/settings";
import { LegacyVideoPreview } from "./legacy-video-preview";
import { VideoJsV10Preview } from "./video-js-v10-preview";
import type { AddonSubtitle } from "@/lib/addons/types";
import { DebridFileNode } from "@/lib/types";

interface VideoPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
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
export function VideoPreview({ file, downloadUrl, subtitles, onLoad, onError }: VideoPreviewProps) {
    const engine = useSettingsStore((s) => s.get("videoPreviewEngine")) as VideoPreviewEngine;

    const legacy = (
        <LegacyVideoPreview
            file={file}
            downloadUrl={downloadUrl}
            subtitles={subtitles}
            onLoad={onLoad}
            onError={onError}
        />
    );

    if (engine === "legacy") {
        return legacy;
    }

    return (
        <VideoPreviewErrorBoundary fallback={legacy}>
            <VideoJsV10Preview
                file={file}
                downloadUrl={downloadUrl}
                subtitles={subtitles}
                onLoad={onLoad}
                onError={onError}
            />
        </VideoPreviewErrorBoundary>
    );
}
