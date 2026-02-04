"use client";

import { DebridFileNode, FileType } from "@/lib/types";
import { getFileType } from "@/lib/utils";
import { getPreviewRenderer } from "@/lib/preview/registry";
import { AlertCircle } from "lucide-react";
import type { AddonSubtitle } from "@/lib/addons/types";

interface PreviewContentProps {
    file: DebridFileNode;
    downloadUrl: string;
    streamingLinks?: Record<string, string>;
    /** Override auto-detected file type */
    fileType?: FileType;
    /** Optional subtitle tracks (browser video only) */
    subtitles?: AddonSubtitle[];
}

export function PreviewContent({
    file,
    downloadUrl,
    streamingLinks,
    fileType: explicitFileType,
    subtitles,
}: PreviewContentProps) {
    const fileType = explicitFileType ?? getFileType(file.name);
    const renderer = getPreviewRenderer(fileType);

    if (!renderer) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <AlertCircle className="h-12 w-12 mb-2" />
                <p className="text-sm">Preview not available for this file type</p>
                <p className="text-xs mt-1 text-muted-foreground/70">{file.name}</p>
            </div>
        );
    }

    const RendererComponent = renderer.component;
    return (
        <RendererComponent
            key={file.id}
            file={file}
            downloadUrl={downloadUrl}
            streamingLinks={streamingLinks}
            {...(subtitles && subtitles.length > 0 ? { subtitles } : {})}
        />
    );
}
