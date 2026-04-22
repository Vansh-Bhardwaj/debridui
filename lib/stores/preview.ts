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
    /**
     * Update a single-mode preview in place (URL / title / subtitles / progressKey)
     * WITHOUT resetting React state or stopping the video element. Use this when
     * switching source or advancing to the next episode while keeping fullscreen
     * and avoiding an unmount-remount of the player subtree.
     */
    updateSingleSource: (options: Partial<SinglePreviewOptions>) => void;
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

/** Stop any currently playing video to prevent ghost audio during preview transitions */
function _stopActiveVideo() {
    if (typeof document === "undefined") return;
    // Find any video element inside the preview dialog and fully release it
    const videos = document.querySelectorAll<HTMLVideoElement>("[role='dialog'] video, .debridui-legacy-player video");
    for (const video of videos) {
        video.pause();
        video.removeAttribute("src");
        video.load();
    }
}

export const usePreviewStore = create<PreviewState>()((set, get) => ({
    ...initialState,

    openPreview: (file, allFiles, fileId) => {
        // Kill any existing video playback to prevent ghost audio
        _stopActiveVideo();
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
        // Kill any existing video playback to prevent ghost audio
        _stopActiveVideo();
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

    updateSingleSource: (options) => {
        const state = get();
        if (!state.isOpen || state.mode !== "single") {
            // Fall back to opening fresh if preview isn't already active
            if (options.url !== undefined && options.title !== undefined) {
                get().openSinglePreview({
                    url: options.url,
                    title: options.title,
                    fileType: options.fileType,
                    subtitles: options.subtitles,
                    progressKey: options.progressKey,
                    streamingLinks: options.streamingLinks,
                });
            }
            return;
        }
        const patch: Partial<PreviewState> = {};
        if (options.url !== undefined) patch.directUrl = options.url || null;
        if (options.title !== undefined) patch.directTitle = options.title;
        if (options.fileType !== undefined) patch.fileType = options.fileType ?? null;
        if (options.subtitles !== undefined) patch.directSubtitles = options.subtitles ?? [];
        if (options.streamingLinks !== undefined) patch.directStreamingLinks = options.streamingLinks;
        if (options.progressKey !== undefined) patch.progressKey = options.progressKey ?? null;
        // Reset redirect chain for the new source
        patch.redirectChain = undefined;
        set(patch);
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
