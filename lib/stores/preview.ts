import { create } from "zustand";
import { DebridFileNode, FileType } from "../types";
import { filterPreviewableFiles } from "../preview/registry";
import type { AddonSubtitle } from "../addons/types";
import type { ProgressKey } from "@/hooks/use-progress";

type PreviewMode = "gallery" | "single";

interface SinglePreviewOptions {
    url: string;
    title: string;
    fileType?: FileType;
    /** Optional subtitle tracks (e.g. from addons) for browser playback */
    subtitles?: AddonSubtitle[];
    /** Progress tracking key for continue watching feature */
    progressKey?: ProgressKey;
    /** Streaming links (HLS, transcoded) fetched from the debrid provider */
    streamingLinks?: Record<string, string>;
}

interface PreviewState {
    // State
    isOpen: boolean;
    mode: PreviewMode;
    currentFile: DebridFileNode | null;
    currentIndex: number;
    previewableFiles: DebridFileNode[];
    fileId: string | null;
    // Single mode state (direct URL, no API fetch)
    directUrl: string | null;
    directTitle: string | null;
    fileType: FileType | null;
    directSubtitles: AddonSubtitle[];
    directStreamingLinks: Record<string, string> | undefined;
    /** Redirect chain URLs from addon URL resolution (for extracting debrid provider params) */
    redirectChain: string[] | undefined;
    progressKey: ProgressKey | null;

    // Actions
    openPreview: (file: DebridFileNode, allFiles: DebridFileNode[], fileId: string) => void;
    openSinglePreview: (options: SinglePreviewOptions) => void;
    /** Update the URL for a single-mode preview (e.g. after resolving a redirect) */
    setDirectUrl: (url: string) => void;
    /** Update streaming links for a single-mode preview */
    setDirectStreamingLinks: (links: Record<string, string>) => void;
    /** Update subtitle tracks (e.g. when auto-fetched after preview opens) */
    setDirectSubtitles: (subtitles: AddonSubtitle[]) => void;
    /** Set the redirect chain from URL resolution */
    setRedirectChain: (chain: string[]) => void;
    closePreview: () => void;
    navigateNext: () => void;
    navigatePrevious: () => void;
    setCurrentIndex: (index: number) => void;
}

const initialState = {
    isOpen: false,
    mode: "gallery" as PreviewMode,
    currentFile: null,
    currentIndex: 0,
    previewableFiles: [],
    fileId: null,
    directUrl: null,
    directTitle: null,
    fileType: null,
    directSubtitles: [],
    directStreamingLinks: undefined as Record<string, string> | undefined,
    redirectChain: undefined as string[] | undefined,
    progressKey: null,
};

export const usePreviewStore = create<PreviewState>()((set, get) => ({
    ...initialState,

    openPreview: (file, allFiles, fileId) => {
        // Filter files by supported types using registry
        const previewableFiles = filterPreviewableFiles(allFiles);
        const currentIndex = previewableFiles.findIndex((f) => f.id === file.id || f.name === file.name);

        set({
            isOpen: true,
            mode: "gallery",
            currentFile: file,
            currentIndex: currentIndex >= 0 ? currentIndex : 0,
            previewableFiles,
            fileId,
            directUrl: null,
            directTitle: null,
            fileType: null,
            progressKey: null,
        });
    },

    openSinglePreview: ({ url, title, fileType, subtitles, progressKey, streamingLinks }) => {
        set({
            isOpen: true,
            mode: "single",
            directUrl: url || null,
            directTitle: title,
            fileType: fileType ?? null,
            directSubtitles: subtitles ?? [],
            directStreamingLinks: streamingLinks,
            redirectChain: undefined,
            progressKey: progressKey ?? null,
            currentFile: null,
            currentIndex: 0,
            previewableFiles: [],
            fileId: null,
        });
    },

    setDirectUrl: (url) => set({ directUrl: url }),
    setDirectStreamingLinks: (links) => set({ directStreamingLinks: links }),
    setDirectSubtitles: (subtitles) => set({ directSubtitles: subtitles }),
    setRedirectChain: (chain) => set({ redirectChain: chain }),

    closePreview: () => set(initialState),

    navigateNext: () => {
        const { currentIndex, previewableFiles } = get();
        if (previewableFiles.length === 0) return;

        const nextIndex = (currentIndex + 1) % previewableFiles.length;
        set({
            currentIndex: nextIndex,
            currentFile: previewableFiles[nextIndex],
        });
    },

    navigatePrevious: () => {
        const { currentIndex, previewableFiles } = get();
        if (previewableFiles.length === 0) return;

        const prevIndex = currentIndex === 0 ? previewableFiles.length - 1 : currentIndex - 1;
        set({
            currentIndex: prevIndex,
            currentFile: previewableFiles[prevIndex],
        });
    },

    setCurrentIndex: (index) => {
        const { previewableFiles } = get();
        if (index >= 0 && index < previewableFiles.length) {
            set({
                currentIndex: index,
                currentFile: previewableFiles[index],
            });
        }
    },
}));
