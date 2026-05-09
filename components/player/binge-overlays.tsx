"use client";

import React, { useEffect, useRef, useState } from "react";
import { SkipForward, X } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════════
   Transition Overlay
   ───────────────────────────────────────────────────────────────────────────────
   Shown during episode switches. Modern flat design with animated elements:
   - A full-screen dark surface (no blur — matches design system)
   - Animated primary-colored progress dots that pulse in sequence
   - A delayed text label that only appears for slow transitions

   Renders INSIDE the player container so it stays visible in native fullscreen.
   Uses `pointer-events: all` to block accidental clicks on the underlying video.
   ═══════════════════════════════════════════════════════════════════════════════ */

export function TransitionOverlay({
    isVisible,
}: {
    isVisible: boolean;
}) {
    // Delay showing the text so fast transitions feel instantaneous.
    // `showText` is derived from `isVisible` + elapsed time; we only need
    // a ref timer to flip the delayed state, so we lazy-init via a ref.
    const [showText, setShowText] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Clean up any pending timer first so an isVisible flip doesn't leak.
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (!isVisible) {
            // Safe: one-shot reset when becoming hidden.
            if (showText) setShowText(false);
            return;
        }
        timerRef.current = setTimeout(() => setShowText(true), 1200);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = null;
        };
        // showText intentionally omitted — it's set via the timer below and
        // reading it would cause the effect to re-run every time text toggles.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVisible]);

    if (!isVisible) return null;

    return (
        <div
            className="player-transition-overlay absolute inset-0 z-[55] pointer-events-auto flex items-center justify-center"
        >
            {/* Top loading bar — reuses existing player CSS class */}
            <div className="player-loading-bar" />

            {/* Center indicator — animated dot sequence */}
            <div className="player-transition-center">
                <div className="player-transition-dots">
                    <span className="player-transition-dot" style={{ animationDelay: "0ms" }} />
                    <span className="player-transition-dot" style={{ animationDelay: "160ms" }} />
                    <span className="player-transition-dot" style={{ animationDelay: "320ms" }} />
                </div>
                {showText && (
                    <p className="player-transition-label">
                        Loading next episode
                    </p>
                )}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Auto-Next Episode Card
   ───────────────────────────────────────────────────────────────────────────────
   Compact card in the CTA stack. Uses a countdown ring driven by CSS animation
   (--countdown-duration). Dark surface, no blur, clean typography, spring easing.

   The `totalDuration` prop drives the ring animation speed and must equal the
   total countdown seconds (from user settings). This is distinct from the
   current `countdown` display number which ticks down every second.
   ═══════════════════════════════════════════════════════════════════════════════ */

export function AutoNextCard({
    countdown,
    totalDuration,
    onNext,
    onDismiss,
    isTransitioning,
}: {
    countdown: number | null;
    /** The total countdown duration from settings (drives the ring animation). */
    totalDuration: number;
    onNext: () => void;
    onDismiss: () => void;
    isTransitioning: boolean;
}) {
    if (countdown === null || isTransitioning) return null;

    return (
        <div className="player-cta-auto-next flex flex-col items-end gap-2">
            <div
                className="player-cta-card rounded-lg border border-white/[0.12] overflow-hidden"
                style={{ background: "rgba(0,0,0,0.95)", maxWidth: 320 }}
            >
                <div className="px-4 pt-3 pb-1">
                    <p className="text-[11px] uppercase tracking-wider text-white/40 font-medium">Up Next</p>
                </div>
                <button
                    type="button"
                    onClick={onNext}
                    className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-[background,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.05] active:scale-[0.98]"
                >
                    {/* Countdown ring — uses existing .player-countdown-ring keyframe */}
                    <svg width="28" height="28" viewBox="0 0 40 40" className="shrink-0 -rotate-90">
                        <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                        <circle
                            cx="20" cy="20" r="18" fill="none" stroke="var(--primary)" strokeWidth="2.5"
                            strokeDasharray="113" className="player-countdown-ring"
                            style={{ "--countdown-duration": `${totalDuration}s` } as React.CSSProperties}
                        />
                    </svg>
                    <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium text-white truncate">Next Episode</p>
                        <p className="text-[11px] text-white/40 tabular-nums">{countdown}s</p>
                    </div>
                    <SkipForward className="size-4 text-white/60 shrink-0" />
                </button>
            </div>
            {/* Dismiss button — same treatment as skip intro dismiss */}
            <button
                type="button"
                aria-label="Dismiss"
                onClick={onDismiss}
                className="flex items-center justify-center rounded-md p-2 transition-[background,color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.08] active:scale-90"
                style={{ background: "rgba(0,0,0,0.85)", color: "rgba(255,255,255,0.5)" }}
            >
                <X className="size-3" />
            </button>
        </div>
    );
}
