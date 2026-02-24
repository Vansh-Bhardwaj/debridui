"use client";

import React, { memo } from "react";
import { DebridFile, DebridNode } from "@/lib/types";
import { FileListItem } from "./file-list-item";
import { ExpandedRow } from "./expanded-row";
import { useFileSelectionState, useSelectionStore } from "@/lib/stores/selection";
import { useState } from "react";
import { queryClient } from "@/lib/query-client";
import { processFileNodes, collectNodeIds } from "@/lib/utils/file";
import { getTorrentFilesCacheKey } from "@/lib/utils/cache-keys";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

interface FileListRowProps {
    file: DebridFile;
    autoExpand?: boolean;
}

export const FileListRow = memo(function FileListRow({ file, autoExpand = false }: FileListRowProps) {
    const { currentAccount } = useAuthGuaranteed();
    const isSelected = useFileSelectionState(file.id);
    const [isExpanded, setIsExpanded] = useState(
        autoExpand && (file.status === "completed" || file.status === "seeding")
    );
    const toggleFileSelection = useSelectionStore((state) => state.toggleFileSelection);

    const handleSelectFile = () => {
        // Use files from DebridFile if available, otherwise check cache
        const fileNodes =
            file.files || queryClient.getQueryData<DebridNode[]>(getTorrentFilesCacheKey(currentAccount.id, file.id));
        const processedFileNodes = processFileNodes({ fileNodes: fileNodes || [] });
        toggleFileSelection(file.id, processedFileNodes ? collectNodeIds(processedFileNodes) : [], processedFileNodes);
    };

    const canExpand = file.status === "completed" || file.status === "seeding";

    return (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <FileListItem
                file={file}
                isSelected={isSelected}
                isExpanded={isExpanded}
                canExpand={canExpand}
                onToggleSelect={handleSelectFile}
                onToggleExpand={() => setIsExpanded(!isExpanded)}
            />
            {canExpand && (
                <CollapsibleContent className="border-b border-border/50 bg-muted/10">
                    <ExpandedRow file={file} />
                </CollapsibleContent>
            )}
        </Collapsible>
    );
});
