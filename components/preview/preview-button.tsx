"use client";

import { memo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { View } from "lucide-react";
import { DebridFileNode } from "@/lib/types";
import { usePreviewStore } from "@/lib/stores/preview";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { getDownloadLinkCacheKey } from "@/lib/utils/cache-keys";
import { QUERY_CACHE_STALE_TIME } from "@/lib/constants";

interface PreviewButtonProps {
    node: DebridFileNode;
    allNodes: DebridFileNode[];
    fileId: string;
}

export const PreviewButton = memo(function PreviewButton({ node, allNodes, fileId }: PreviewButtonProps) {
    const openPreview = usePreviewStore((state) => state.openPreview);
    const queryClient = useQueryClient();
    const { client, currentAccount } = useAuthGuaranteed();

    const prefetchDownloadLink = useCallback(() => {
        if (!node.id) return;
        void queryClient.prefetchQuery({
            queryKey: getDownloadLinkCacheKey(currentAccount.id, node.id, true),
            queryFn: () => client.getDownloadLink({ fileNode: node, resolve: true }),
            staleTime: QUERY_CACHE_STALE_TIME,
        });
    }, [queryClient, client, currentAccount.id, node]);

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            openPreview(node, allNodes, fileId);
        },
        [node, allNodes, fileId, openPreview]
    );

    return (
        <Button
            variant="ghost"
            size="icon"
            className="size-4 sm:size-6 cursor-pointer"
            onClick={handleClick}
            onMouseEnter={prefetchDownloadLink}
            onFocus={prefetchDownloadLink}
            title="Preview">
            <View className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        </Button>
    );
});
