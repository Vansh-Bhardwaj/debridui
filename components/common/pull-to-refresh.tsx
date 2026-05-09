"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface PullToRefreshProps {
    onRefresh: () => Promise<unknown> | void;
    children: React.ReactNode;
    /** Pull distance (px) at which a release will trigger onRefresh. */
    threshold?: number;
    /** Disable on desktop — set to false to force-enable for testing. */
    mobileOnly?: boolean;
    className?: string;
}

const DEFAULT_THRESHOLD = 72;
const DAMP = 0.45;
const MAX_PULL = 140;

/** Wraps children and triggers onRefresh on a mobile pull-down gesture when
 * the window is scrolled to the top. Shows a subtle indicator while pulling. */
export function PullToRefresh({ onRefresh, children, threshold = DEFAULT_THRESHOLD, mobileOnly = true, className }: PullToRefreshProps) {
    const [pull, setPull] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const startY = useRef<number | null>(null);
    const triggered = useRef(false);

    useEffect(() => {
        if (mobileOnly && typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches) {
            return;
        }

        const onTouchStart = (e: TouchEvent) => {
            if (isRefreshing) return;
            if (window.scrollY > 0) {
                startY.current = null;
                return;
            }
            const t = e.touches[0];
            if (!t) return;
            startY.current = t.clientY;
            triggered.current = false;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (startY.current == null || isRefreshing) return;
            if (window.scrollY > 0) {
                startY.current = null;
                setPull(0);
                return;
            }
            const t = e.touches[0];
            if (!t) return;
            const raw = t.clientY - startY.current;
            if (raw <= 0) {
                setPull(0);
                return;
            }
            const damped = Math.min(MAX_PULL, raw * DAMP);
            setPull(damped);
        };

        const onTouchEnd = async () => {
            if (startY.current == null) return;
            const shouldRefresh = pull >= threshold && !triggered.current && !isRefreshing;
            startY.current = null;
            if (shouldRefresh) {
                triggered.current = true;
                setIsRefreshing(true);
                try {
                    await onRefresh();
                } finally {
                    setIsRefreshing(false);
                    setPull(0);
                }
            } else {
                setPull(0);
            }
        };

        document.addEventListener("touchstart", onTouchStart, { passive: true });
        document.addEventListener("touchmove", onTouchMove, { passive: true });
        document.addEventListener("touchend", onTouchEnd, { passive: true });
        return () => {
            document.removeEventListener("touchstart", onTouchStart);
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
        };
    }, [isRefreshing, mobileOnly, onRefresh, pull, threshold]);

    const progress = Math.min(1, pull / threshold);
    const showIndicator = pull > 0 || isRefreshing;

    return (
        <div className={cn("relative", className)}>
            <div
                className={cn(
                    "pointer-events-none sticky top-0 z-30 flex justify-center transition-opacity",
                    showIndicator ? "opacity-100" : "opacity-0"
                )}
                style={{ height: 0 }}
                aria-hidden="true"
            >
                <div
                    className="mt-2 flex size-9 items-center justify-center rounded-full border border-border/50 bg-background/90 text-muted-foreground shadow-sm backdrop-blur"
                    style={{ transform: `translateY(${isRefreshing ? 0 : Math.min(pull, threshold) - 40}px)` }}
                >
                    {isRefreshing ? (
                        <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                        <ArrowDown
                            className="size-4 transition-transform duration-200"
                            style={{ transform: `rotate(${progress >= 1 ? 180 : 0}deg)`, color: progress >= 1 ? "var(--primary)" : undefined }}
                        />
                    )}
                </div>
            </div>
            {children}
        </div>
    );
}
