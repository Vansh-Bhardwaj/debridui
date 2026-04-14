"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DebridFileNode, AccountType } from "@/lib/types";
import { Loader2, AlertCircle } from "lucide-react";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { getProxyUrl } from "@/lib/utils";
import { List, type RowComponentProps } from "react-window";

interface TextPreviewProps {
    file: DebridFileNode;
    downloadUrl: string;
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

const LINE_HEIGHT = 22;
const ROW_OVERSCAN = 10;
/** Above this line count, render with react-window so the DOM stays small on big logs/subtitles. */
const VIRTUALIZE_LINE_THRESHOLD = 160;
const VIRTUALIZE_CHAR_THRESHOLD = 64_000;
/** Cap extremely long single lines so layout stays bounded (horizontal scroll for the rest). */
const MAX_LINE_DISPLAY_CHARS = 32_000;

interface TextVirtualRowProps {
    lines: string[];
}

function TextVirtualRow(props: RowComponentProps<TextVirtualRowProps>) {
    const { index, style, lines } = props;
    const raw = lines[index] ?? "";
    const line =
        raw.length > MAX_LINE_DISPLAY_CHARS ? `${raw.slice(0, MAX_LINE_DISPLAY_CHARS)}…` : raw;
    return (
        <div
            style={style}
            className="font-mono text-[13px] leading-[22px] text-foreground px-6 whitespace-pre min-w-0 overflow-x-auto border-b border-transparent hover:bg-foreground/[0.04]">
            {line.length === 0 ? "\u00a0" : line}
        </div>
    );
}

function TextVirtualizedBody({ content }: { content: string }) {
    const lines = useMemo(() => content.split(/\r?\n/), [content]);
    const outerRef = useRef<HTMLDivElement>(null);
    const [listHeight, setListHeight] = useState(400);

    useLayoutEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const measure = () => setListHeight(Math.max(120, el.clientHeight));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const rowProps = useMemo(() => ({ lines }), [lines]);

    return (
        <div ref={outerRef} className="w-full h-full min-h-0 min-w-0 bg-background">
            <List
                rowComponent={TextVirtualRow}
                rowProps={rowProps}
                rowCount={lines.length}
                rowHeight={LINE_HEIGHT}
                overscanCount={ROW_OVERSCAN}
                className="outline-none!"
                style={{ height: listHeight, width: "100%" }}
            />
        </div>
    );
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

    const { useVirtual, lineCount } = useMemo(() => {
        if (content === undefined) return { useVirtual: false, lineCount: 0 };
        const lc = content.split(/\r?\n/).length;
        return {
            lineCount: lc,
            useVirtual: lc >= VIRTUALIZE_LINE_THRESHOLD || content.length >= VIRTUALIZE_CHAR_THRESHOLD,
        };
    }, [content]);

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

    if (content === undefined) return null;

    if (useVirtual) {
        return (
            <div className="w-full h-full flex flex-col min-h-0 bg-foreground/5">
                <p className="shrink-0 text-[11px] text-muted-foreground px-4 py-2 border-b border-border/40">
                    Large file: virtualized view ({lineCount.toLocaleString()} lines) for smoother scrolling.
                </p>
                <div className="flex-1 min-h-0">
                    <TextVirtualizedBody content={content} />
                </div>
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
