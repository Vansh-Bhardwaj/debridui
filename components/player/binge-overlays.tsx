"use client";

import React from "react";
import { Loader2, X, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Transition overlay shown during episode switches.
 *
 * Renders INSIDE the player container so it remains visible in native fullscreen.
 * Uses pointer-events: all to block accidental clicks on the underlying player.
 */
export function TransitionOverlay({
    isVisible,
}: {
    isVisible: boolean;
}) {
    if (!isVisible) return null;

    return (
        <div
            className="absolute inset-0 z-[55] flex flex-col items-center justify-center gap-3 pointer-events-auto animate-in fade-in-0 duration-200"
            style={{ background: "rgba(0,0,0,0.72)" }}
        >
            <Loader2 className="h-10 w-10 animate-spin text-white/90" />
            <p className="text-sm font-medium text-white/80">Loading stream…</p>
        </div>
    );
}

/**
 * Auto-next episode countdown popup.
 *
 * Shows a small countdown near the bottom of the player when the current episode
 * is about to end. The user can click "Next Episode" to advance immediately, or
 * dismiss the popup to cancel auto-advance.
 *
 * Guards:
 *   - Hidden during transition (overlay takes over)
 *   - "Next Episode" button goes through guardedNav
 */
export function AutoNextPopup({
    countdown,
    onNext,
    onDismiss,
    isTransitioning,
}: {
    countdown: number | null;
    onNext: () => void;
    onDismiss: () => void;
    isTransitioning: boolean;
}) {
    if (countdown === null || isTransitioning) return null;

    return (
        <div className="absolute bottom-24 right-4 z-[52] flex items-center gap-2 pointer-events-auto animate-in slide-in-from-right-4 fade-in-0 duration-300">
            <div
                className="flex items-center gap-3 rounded-xl px-4 py-2.5 shadow-2xl"
                style={{
                    background: "rgba(18, 18, 22, 0.95)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset",
                }}
            >
                <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] tracking-wide uppercase text-white/40">
                        Next episode in
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-white">
                        {countdown}s
                    </span>
                </div>

                <button
                    onClick={onNext}
                    className={cn(
                        "flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium",
                        "bg-white text-black hover:bg-white/90 active:scale-[0.97]",
                        "transition-all duration-150"
                    )}
                >
                    <SkipForward className="h-4 w-4" />
                    Next Episode
                </button>

                <button
                    onClick={onDismiss}
                    className="flex items-center justify-center rounded-md bg-black/85 p-2 text-white/50 transition-all hover:bg-white/10 hover:text-white active:scale-90"
                >
                    <X className="size-3" />
                </button>
            </div>
        </div>
    );
}
