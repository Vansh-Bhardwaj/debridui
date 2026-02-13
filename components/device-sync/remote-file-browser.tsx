/**
 * RemoteFileBrowser — browse files on a remote device from the controller.
 *
 * Sends browse-request messages to the target device, receives browse-response
 * with file listings. Supports paginated file list + search. Displayed in
 * the device picker or remote banner.
 */

"use client";

import { useState, useCallback } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import type { BrowseFileItem } from "@/lib/device-sync/protocol";
import { Search, File, Loader2, FolderOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface RemoteFileBrowserProps {
    targetDeviceId: string;
    onSelect?: (file: BrowseFileItem) => void;
    className?: string;
}

export function RemoteFileBrowser({ targetDeviceId, onSelect, className }: RemoteFileBrowserProps) {
    const browseDevice = useDeviceSyncStore((s) => s.browseDevice);

    const [files, setFiles] = useState<BrowseFileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState<number | undefined>();
    const [offset, setOffset] = useState(0);
    const [loaded, setLoaded] = useState(false);

    const PAGE_SIZE = 20;

    const fetchFiles = useCallback(async (action: "list-files" | "search", q: string, page: number) => {
        setLoading(true);
        setError(null);

        const response = await browseDevice(targetDeviceId, {
            action,
            query: q || undefined,
            offset: page,
            limit: PAGE_SIZE,
        });

        setLoading(false);

        if (response.error) {
            setError(response.error);
            return;
        }

        setFiles(response.files);
        setHasMore(response.hasMore ?? false);
        setTotal(response.total);
        setOffset(page);
        setLoaded(true);
    }, [browseDevice, targetDeviceId]);

    const handleLoadFiles = useCallback(() => {
        fetchFiles("list-files", "", 0);
    }, [fetchFiles]);

    const handleSearch = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) {
            fetchFiles("list-files", "", 0);
        } else {
            fetchFiles("search", query, 0);
        }
    }, [fetchFiles, query]);

    const handlePrev = useCallback(() => {
        const newOffset = Math.max(0, offset - PAGE_SIZE);
        fetchFiles("list-files", "", newOffset);
    }, [fetchFiles, offset]);

    const handleNext = useCallback(() => {
        fetchFiles("list-files", "", offset + PAGE_SIZE);
    }, [fetchFiles, offset]);

    if (!loaded && !loading) {
        return (
            <div className={cn("space-y-3", className)}>
                <p className="text-xs tracking-widest uppercase text-muted-foreground px-1">
                    Remote Files
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadFiles}
                    className="w-full gap-2"
                >
                    <FolderOpen className="size-4" />
                    Browse files on this device
                </Button>
            </div>
        );
    }

    return (
        <div className={cn("space-y-3", className)}>
            <p className="text-xs tracking-widest uppercase text-muted-foreground px-1">
                Remote Files{total !== undefined && ` · ${total} total`}
            </p>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2">
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search files..."
                    className="h-8 text-xs"
                />
                <Button type="submit" variant="outline" size="sm" className="h-8 shrink-0">
                    <Search className="size-3.5" />
                </Button>
            </form>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-4">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Error */}
            {error && (
                <p className="text-xs text-destructive px-1">{error}</p>
            )}

            {/* File list */}
            {!loading && files.length === 0 && loaded && (
                <p className="text-xs text-muted-foreground px-1 py-3 text-center">
                    No files found
                </p>
            )}

            {!loading && files.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                    {files.map((file) => (
                        <button
                            key={file.id}
                            onClick={() => onSelect?.(file)}
                            className="flex items-center gap-2 w-full text-left rounded-sm px-2 py-1.5 hover:bg-muted/30 transition-colors"
                        >
                            <File className="size-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs truncate">{file.name}</p>
                                <p className="text-[10px] text-muted-foreground">
                                    {formatSize(file.size)}
                                    {file.status !== "downloaded" && (
                                        <> <span className="text-border">·</span> {file.status}</>
                                    )}
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Pagination */}
            {!loading && loaded && (hasMore || offset > 0) && (
                <div className="flex items-center justify-between">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={offset === 0}
                        onClick={handlePrev}
                    >
                        <ChevronLeft className="size-3" />
                        Prev
                    </Button>
                    <span className="text-[10px] text-muted-foreground">
                        {offset + 1}–{offset + files.length}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={!hasMore}
                        onClick={handleNext}
                    >
                        Next
                        <ChevronRight className="size-3" />
                    </Button>
                </div>
            )}
        </div>
    );
}
