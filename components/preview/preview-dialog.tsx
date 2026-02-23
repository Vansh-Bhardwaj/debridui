"use client";

import { useEffect, useCallback, useRef, useMemo } from "react";
import { usePreviewStore } from "@/lib/stores/preview";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useUserAddons } from "@/hooks/use-addons";
import { type Addon } from "@/lib/addons/types";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, X, Loader2 } from "lucide-react";
import { PreviewContent } from "./preview-content";
import { formatSize, downloadLinks, getFileType } from "@/lib/utils";
import { getDownloadLinkCacheKey } from "@/lib/utils/cache-keys";
import { DebridFileNode } from "@/lib/types";
import { type ProgressKey } from "@/hooks/use-progress";

export function PreviewDialog() {
    const { client, currentAccount } = useAuthGuaranteed();

    const previousButtonRef = useRef<HTMLButtonElement>(null);
    const nextButtonRef = useRef<HTMLButtonElement>(null);

    const {
        episodeContext,
        playNextEpisode,
        playPreviousEpisode,
        preloadNextEpisode
    } = useStreamingStore();
    const { data: addons = [] } = useUserAddons();

    const {
        isOpen,
        mode,
        currentFile,
        currentIndex,
        previewableFiles,
        directUrl,
        directTitle,
        fileType,
        directSubtitles,
        directStreamingLinks,
        redirectChain,
        closePreview,
        navigateNext,
        navigatePrevious,
        progressKey,
    } = usePreviewStore();

    const isSingleMode = mode === "single";

    // In gallery mode, derive progressKey from episodeContext + filename S/E match
    // so progress tracking and IntroDB skip-intro work even when playing from file explorer
    const effectiveProgressKey = useMemo<ProgressKey | undefined>(() => {
        if (progressKey) return progressKey;
        if (!isSingleMode && episodeContext && currentFile) {
            const patterns = [
                /[Ss](\d{1,4})[Ee](\d{1,4})/,
                /(\d{1,4})x(\d{1,4})/,
                /season\s*(\d{1,4})\D+episode\s*(\d{1,4})/i,
            ];
            let match: RegExpExecArray | null = null;
            for (const pattern of patterns) {
                match = pattern.exec(currentFile.name);
                if (match) break;
            }

            if (match && parseInt(match[1]) === episodeContext.season && parseInt(match[2]) === episodeContext.episode) {
                return {
                    imdbId: episodeContext.imdbId,
                    type: 'show',
                    season: episodeContext.season,
                    episode: episodeContext.episode,
                };
            }

            return {
                imdbId: episodeContext.imdbId,
                type: 'show',
                season: episodeContext.season,
                episode: episodeContext.episode,
            };
        }
        return progressKey ?? undefined;
    }, [progressKey, isSingleMode, episodeContext, currentFile]);

    // Create mock file node for single mode
    const singleFileNode = useMemo<DebridFileNode | null>(() => {
        if (!isSingleMode || !directTitle) return null;
        return { id: directUrl || "loading", name: directTitle, size: undefined, type: "file", children: [] };
    }, [isSingleMode, directUrl, directTitle]);

    // Fetch download link for current file (gallery mode only)
    const { data: linkInfo, isLoading } = useQuery({
        queryKey: getDownloadLinkCacheKey(currentAccount.id, currentFile?.id || "", true),
        queryFn: () => client.getDownloadLink({ fileNode: currentFile!, resolve: true }),
        enabled: isOpen && !isSingleMode && !!currentFile?.id,
        gcTime: 15 * 60 * 1000, // 15 minutes
    });

    // In single mode (addon playback), try to fetch streaming links (HLS/transcoded)
    // from the debrid provider using the resolved download URL or intermediate redirect URLs.
    // This enables iOS Safari to use HLS instead of raw download URLs, and lets TorBox
    // extract torrent_id/file_id from API URLs in the redirect chain.
    const { data: fetchedStreamingLinks } = useQuery<Record<string, string>>({
        queryKey: ["preview", "streaming-links", directUrl, currentAccount.id],
        queryFn: async () => {
            // Try the resolved URL first
            const links = await client.getStreamingLinksFromUrl(directUrl!);
            if (Object.keys(links).length > 0) return links;

            // Try each URL in the redirect chain (e.g. TorBox API URL with torrent_id)
            if (redirectChain?.length) {
                for (const chainUrl of redirectChain) {
                    const chainLinks = await client.getStreamingLinksFromUrl(chainUrl);
                    if (Object.keys(chainLinks).length > 0) return chainLinks;
                }
            }

            return {};
        },
        enabled: isOpen && isSingleMode && !!directUrl && !directStreamingLinks,
        staleTime: 5 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: 1,
        retryDelay: (attempt) => Math.min(1000, attempt * 500),
    });

    // Merge: store-provided streaming links take priority, then fetched
    const singleStreamingLinks = directStreamingLinks ?? fetchedStreamingLinks;

    const handleNext = useCallback(() => {
        if (!isSingleMode) {
            navigateNext();
        } else if (episodeContext) {
            const enabledAddons = addons
                .filter((a: Addon) => a.enabled)
                .sort((a: Addon, b: Addon) => a.order - b.order)
                .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));
            playNextEpisode(enabledAddons);
        }
    }, [isSingleMode, navigateNext, episodeContext, addons, playNextEpisode]);

    const handlePrev = useCallback(() => {
        if (!isSingleMode) {
            navigatePrevious();
        } else if (episodeContext) {
            const enabledAddons = addons
                .filter((a: Addon) => a.enabled)
                .sort((a: Addon, b: Addon) => a.order - b.order)
                .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));
            playPreviousEpisode(enabledAddons);
        }
    }, [isSingleMode, navigatePrevious, episodeContext, addons, playPreviousEpisode]);

    const handlePreload = useCallback(() => {
        if (isSingleMode && episodeContext) {
            const enabledAddons = addons
                .filter((a: Addon) => a.enabled)
                .sort((a: Addon, b: Addon) => a.order - b.order)
                .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));
            preloadNextEpisode(enabledAddons);
        }
    }, [isSingleMode, episodeContext, addons, preloadNextEpisode]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Skip arrow key interception for video content — let the video player handle ±5s seeking
            const currentFileType = isSingleMode
                ? (fileType ?? getFileType(directTitle || ""))
                : getFileType(currentFile?.name || "");
            const isVideoContent = currentFileType === "video";

            switch (e.key) {
                case "ArrowLeft":
                    if (isVideoContent) break; // Let video player handle seeking
                    if (!isSingleMode || episodeContext) {
                        e.preventDefault();
                        handlePrev();
                        previousButtonRef.current?.focus();
                    }
                    break;
                case "ArrowRight":
                    if (isVideoContent) break; // Let video player handle seeking
                    if (!isSingleMode || episodeContext) {
                        e.preventDefault();
                        handleNext();
                        nextButtonRef.current?.focus();
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    closePreview();
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, isSingleMode, episodeContext, handleNext, handlePrev, closePreview, fileType, directTitle, currentFile]);

    const handleDownload = useCallback(() => {
        if (linkInfo) {
            downloadLinks([linkInfo]);
        }
    }, [linkInfo]);

    const activeFile = isSingleMode ? singleFileNode : currentFile;
    const activeUrl = isSingleMode ? directUrl : linkInfo?.link;
    const activeTitle = isSingleMode ? directTitle : currentFile?.name;
    const activeFileType = isSingleMode ? (fileType ?? getFileType(directTitle || "")) : undefined;

    if (!activeFile) return null;

    const hasNav = (!isSingleMode && previewableFiles.length > 1) || (isSingleMode && !!episodeContext);
    const position = isSingleMode && episodeContext
        ? `S${episodeContext.season} E${episodeContext.episode}`
        : `${currentIndex + 1} / ${previewableFiles.length}`;

    return (
        <Dialog open={isOpen} onOpenChange={closePreview}>
            <DialogContent
                className="sm:max-w-[95vw] h-[95vh] p-0 gap-0 flex flex-col overflow-hidden outline-none!"
                showCloseButton={false}
                aria-describedby="preview-dialog-description">
                <DialogTitle className="sr-only">{activeTitle}</DialogTitle>
                <p id="preview-dialog-description" className="sr-only">
                    Preview of {activeTitle}
                </p>
                {/* Header */}
                <div className="flex items-center justify-between p-3 sm:p-4 border-b shrink-0 bg-background">
                    <div className="flex-1 min-w-0 mr-4">
                        <h2 className="text-lg font-light truncate">{activeTitle}</h2>
                        {/* Meta info: size, position */}
                        <div className="flex items-center gap-2 mt-1">
                            {!isSingleMode && activeFile.size && (
                                <span className="text-sm text-muted-foreground">{formatSize(activeFile.size)}</span>
                            )}
                            {hasNav && (
                                <>
                                    {!isSingleMode && activeFile.size && <span className="text-muted-foreground">&middot;</span>}
                                    <span className="text-xs text-muted-foreground">
                                        {position}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!isSingleMode && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleDownload}
                                disabled={!linkInfo}
                                title="Download"
                                aria-label="Download file">
                                <Download className="h-4 w-4" />
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={closePreview}
                            title="Close (Esc)"
                            aria-label="Close preview (Esc)">
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Preview Content */}
                <div
                    className="flex-1 relative overflow-hidden min-h-0 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
                    key={isSingleMode ? directUrl : currentFile?.id}>
                    {!isSingleMode && isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    ) : isSingleMode && !activeUrl ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                            <Loader2 className="h-10 w-10 animate-spin" />
                            <p className="text-sm font-medium">Preparing playback…</p>
                        </div>
                    ) : activeUrl ? (
                        <PreviewContent
                            file={activeFile}
                            downloadUrl={activeUrl}
                            streamingLinks={isSingleMode ? singleStreamingLinks : linkInfo?.streamingLinks}
                            fileType={activeFileType}
                            subtitles={isSingleMode ? directSubtitles : undefined}
                            onNext={hasNav ? handleNext : undefined}
                            onPrev={hasNav ? handlePrev : undefined}
                            onPreload={handlePreload}
                            progressKey={effectiveProgressKey}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            <p>Unable to load preview</p>
                        </div>
                    )}

                    {/* Navigation Arrows (Dialog Overlay) */}
                    {hasNav && (
                        <>
                            <Button
                                ref={previousButtonRef}
                                variant="ghost"
                                size="icon"
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white h-10 w-10 z-30"
                                onClick={handlePrev}
                                title="Previous (←)"
                                aria-label="Previous file (Left arrow)">
                                <ChevronLeft className="h-6 w-6" />
                            </Button>
                            <Button
                                ref={nextButtonRef}
                                variant="ghost"
                                size="icon"
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white h-10 w-10 z-30"
                                onClick={handleNext}
                                title="Next (→)"
                                aria-label="Next file (Right arrow)">
                                <ChevronRight className="h-6 w-6" />
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
