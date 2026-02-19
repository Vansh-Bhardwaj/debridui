"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { DebridFileNode, AccountType } from "@/lib/types";
import { Loader2, AlertCircle } from "lucide-react";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { getProxyUrl } from "@/lib/utils";

interface TextPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

export function TextPreview({ downloadUrl, onLoad, onError }: TextPreviewProps) {
    const { currentUser } = useAuthGuaranteed();
    const fetchUrl = currentUser.type === AccountType.ALLDEBRID ? getProxyUrl(downloadUrl) : downloadUrl;

    const { data: content, isLoading, error } = useQuery({
        queryKey: ["text-preview", fetchUrl],
        queryFn: async () => {
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
            return response.text();
        },
    });

    useEffect(() => {
        if (content !== undefined) onLoad?.();
    }, [content, onLoad]);

    useEffect(() => {
        if (error) onError?.(error instanceof Error ? error : new Error(String(error)));
    }, [error, onError]);

    if (isLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-background text-foreground">
                <AlertCircle className="h-12 w-12 mb-2 text-destructive" />
                <p className="text-sm">Failed to load file</p>
                <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full overflow-auto bg-background">
            <pre className="whitespace-pre-wrap font-mono text-sm text-foreground bg-foreground/10 min-h-full wrap-break-word p-6 max-w-4xl mx-auto">
                {content}
            </pre>
        </div>
    );
}
