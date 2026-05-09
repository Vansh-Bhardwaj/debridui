"use client";

import React, { memo, useState, useCallback, useRef } from "react";
import { DebridFile, DebridNode } from "@/lib/types";
import { FileListItem } from "./file-list-item";
import { ExpandedRow } from "./expanded-row";
import { useFileSelectionState, useSelectionStore } from "@/lib/stores/selection";
import { queryClient } from "@/lib/query-client";
import { processFileNodes, collectNodeIds } from "@/lib/utils/file";
import { getTorrentFilesCacheKey } from "@/lib/utils/cache-keys";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { useFileMutationActions } from "@/hooks/use-file-actions";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileListRowProps {
    file: DebridFile;
    autoExpand?: boolean;
}

const SWIPE_THRESHOLD = 96;
const SWIPE_MAX = 128;

function isTouchDevice() {
    if (typeof window === "undefined") return false;
    return !window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
}

export const FileListRow = memo(function FileListRow({ file, autoExpand = false }: FileListRowProps) {
    const { currentAccount } = useAuthGuaranteed();
    const isSelected = useFileSelectionState(file.id);
    const [isExpanded, setIsExpanded] = useState(
        autoExpand && (file.status === "completed" || file.status === "seeding")
    );
    const [swipeX, setSwipeX] = useState(0);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const startX = useRef<number | null>(null);
    const startY = useRef<number | null>(null);
    const dragging = useRef(false);
    const { deleteMutation } = useFileMutationActions();
    const toggleFileSelection = useSelectionStore((state) => state.toggleFileSelection);

    const handleSelectFile = useCallback(() => {
        const fileNodes =
            file.files || queryClient.getQueryData<DebridNode[]>(getTorrentFilesCacheKey(currentAccount.id, file.id));
        const processedFileNodes = processFileNodes({ fileNodes: fileNodes || [] });
        toggleFileSelection(file.id, processedFileNodes ? collectNodeIds(processedFileNodes) : [], processedFileNodes);
    }, [file, currentAccount.id, toggleFileSelection]);

    const canExpand = file.status === "completed" || file.status === "seeding";

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        if (!isTouchDevice()) return;
        const t = e.touches[0];
        if (!t) return;
        startX.current = t.clientX;
        startY.current = t.clientY;
        dragging.current = false;
    }, []);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        if (startX.current == null || startY.current == null) return;
        const t = e.touches[0];
        if (!t) return;
        const dx = t.clientX - startX.current;
        const dy = t.clientY - startY.current;
        // Only engage horizontal swipe once we've clearly moved left and not up/down.
        if (!dragging.current) {
            if (Math.abs(dy) > 10) {
                startX.current = null;
                return;
            }
            if (dx < -8) dragging.current = true;
            else return;
        }
        if (dx < 0) setSwipeX(Math.max(-SWIPE_MAX, dx));
    }, []);

    const onTouchEnd = useCallback(() => {
        startX.current = null;
        startY.current = null;
        if (!dragging.current) return;
        dragging.current = false;
        if (swipeX <= -SWIPE_THRESHOLD) {
            setShowDeleteConfirm(true);
        }
        setSwipeX(0);
    }, [swipeX]);

    return (
        <>
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <div className="relative overflow-hidden">
                    {/* Delete action revealed on swipe-left. */}
                    <div
                        className={cn(
                            "pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end bg-destructive/90 pr-4 text-destructive-foreground transition-opacity",
                            swipeX < 0 ? "opacity-100" : "opacity-0"
                        )}
                        style={{ width: Math.max(64, Math.abs(swipeX)) }}
                        aria-hidden="true"
                    >
                        <div className="flex items-center gap-2 text-sm">
                            <Trash2 className="size-4" />
                            <span>Delete</span>
                        </div>
                    </div>

                    <div
                        onTouchStart={onTouchStart}
                        onTouchMove={onTouchMove}
                        onTouchEnd={onTouchEnd}
                        onTouchCancel={onTouchEnd}
                        style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 ? "transform 180ms ease" : undefined }}
                    >
                        <FileListItem
                            file={file}
                            isSelected={isSelected}
                            isExpanded={isExpanded}
                            canExpand={canExpand}
                            onToggleSelect={handleSelectFile}
                            onToggleExpand={() => setIsExpanded(!isExpanded)}
                        />
                    </div>
                </div>
                {canExpand && (
                    <CollapsibleContent className="border-b border-border/50 bg-muted/10">
                        <ExpandedRow file={file} />
                    </CollapsibleContent>
                )}
            </Collapsible>

            <ConfirmDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title="Delete file?"
                description={`"${file.name}" will be removed from your account. This cannot be undone.`}
                confirmText="Delete"
                variant="destructive"
                onConfirm={() => deleteMutation.mutate([file.id])}
                isConfirming={deleteMutation.isPending}
            />
        </>
    );
});
