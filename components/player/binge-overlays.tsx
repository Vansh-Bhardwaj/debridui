"use client";

import React, { useEffect, useRef, useState } from "react";
import { SkipForward, X } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════════
   Transition Overlay
   ───────────────────────────────────────────────────────────────────────────────
   Shown during episode switches. Uses the same loading-bar shimmer as the
   existing player (`.player-loading-bar`) plus a cinematic opacity fade over
   the video surface. No spinner icon — just the top loading bar and a subtle
   center text that fades in after a brief delay (avoids flash on fast switches).

   Renders INSIDE the player container so it stays visible in native fullscreen.
   Uses `pointer-events: all` to block accidental clicks on the underlying video.
   ═══════════════════════════════════════════════════════════════════════════════ */

export function TransitionOverlay({
    isVisible,
}: {
    isVisible: boolean;
}) {
    // Delay showing the "Loading…" text so fast transitions feel instant
    const [showText, setShowText] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (isVisible) {
            setShowText(false);
            timerRef.current = setTimeout(() => setShowText(true), 800);
        } else {
            setShowText(false);
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        }
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [isVisible]);

    if (!isVisible) return null;

    return (
        <div
            className="player-transition-overlay absolute inset-0 z-[55] pointer-events-auto"
        >
            {/* Top loading bar — reuses existing player CSS class for visual consistency */}
            <div className="player-loading-bar" />

            {/* Center feedback — only shows after delay for slow transitions */}
            {showText && (
                <div className="player-transition-label">
                    Loading stream…
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Auto-Next Episode Card
   ───────────────────────────────────────────────────────────────────────────────
   Matches the existing auto-next popup in the CTA stack (same position, same
   ring animation via `.player-countdown-ring`, same dark surface + white/alpha
   borders). The difference vs. the old external component: this one is declared
   inline so it can directly reference `markCurrentAsCompleted`, and uses the
   native CSS keyframes that already exist.

   This component is UNUSED if the existing inline JSX for auto-next is kept
   in the player render. It's provided as an alternative for cleaner extraction.
   ═══════════════════════════════════════════════════════════════════════════════ */

export function AutoNextCard({
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
                            style={{ "--countdown-duration": `${countdown}s` } as React.CSSProperties}
                        />
                    </svg>
                    <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium text-white truncate">Next Episode</p>
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
