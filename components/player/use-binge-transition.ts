"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook that manages the binge-watching transition lifecycle.
 *
 * Key design decisions:
 *   - State is LOCAL to the player component (not a global store). This eliminates
 *     the cross-store ownership bugs that plagued the previous isSwitchingSource system.
 *   - `guardedNav` is the single entry point for all navigation actions. It returns
 *     false if a transition is already in progress, preventing double-fire.
 *   - The auto-next countdown is tightly coupled with the transition guard so the popup
 *     automatically cancels when a transition starts and never re-fires during one.
 *   - The `playing` event from the video element clears the transition state.
 */
export interface BingeTransitionState {
    /** True while an episode switch is in progress (overlay visible, controls disabled). */
    isTransitioning: boolean;
    /** Auto-next countdown (null = hidden, number = seconds remaining). */
    autoNextCountdown: number | null;
    /**
     * Wraps a navigation action (onNext/onPrev) with single-flight protection.
     * Returns true if the navigation was dispatched, false if blocked.
     */
    guardedNav: (action: () => void) => boolean;
    /** Manually start a transition (e.g. user clicked next before countdown). */
    startTransition: () => void;
    /** Clear the transition state (e.g. on new video playing or error). */
    clearTransition: () => void;
    /** Cancel the auto-next countdown (user dismissed the popup). */
    cancelAutoNext: () => void;
    /** Start the auto-next countdown. Called from timeupdate when near end. */
    startAutoNextCountdown: (seconds: number, onFire: () => void) => void;
    /** Ref that tracks isTransitioning for use in closures (avoids stale state). */
    isTransitioningRef: React.RefObject<boolean>;
}

export function useBingeTransition(): BingeTransitionState {
    const [isTransitioning, setIsTransitioning] = useState(false);
    const isTransitioningRef = useRef(false);
    const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Keep ref in sync with state for closure access
    useEffect(() => {
        isTransitioningRef.current = isTransitioning;
    }, [isTransitioning]);

    const clearCountdownTimer = useCallback(() => {
        if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
        }
    }, []);

    const cancelAutoNext = useCallback(() => {
        clearCountdownTimer();
        setAutoNextCountdown(null);
    }, [clearCountdownTimer]);

    const startTransition = useCallback(() => {
        setIsTransitioning(true);
        isTransitioningRef.current = true;
        // Kill any active countdown — it's been superseded by the manual nav.
        cancelAutoNext();
    }, [cancelAutoNext]);

    const clearTransition = useCallback(() => {
        setIsTransitioning(false);
        isTransitioningRef.current = false;
    }, []);

    const guardedNav = useCallback(
        (action: () => void): boolean => {
            if (isTransitioningRef.current) return false;
            startTransition();
            action();
            return true;
        },
        [startTransition]
    );

    const startAutoNextCountdown = useCallback(
        (seconds: number, onFire: () => void) => {
            // Don't start a countdown if already transitioning or one is running.
            if (isTransitioningRef.current) return;
            if (countdownTimerRef.current) return;

            const clamped = Math.max(1, Math.min(Math.ceil(seconds), 15));
            setAutoNextCountdown(clamped);
            let remaining = clamped;

            countdownTimerRef.current = setInterval(() => {
                // If a transition started externally (user clicked next), abort.
                if (isTransitioningRef.current) {
                    clearCountdownTimer();
                    setAutoNextCountdown(null);
                    return;
                }

                remaining--;
                if (remaining <= 0) {
                    clearCountdownTimer();
                    setAutoNextCountdown(null);
                    // Fire through guardedNav so the single-flight check applies.
                    if (!isTransitioningRef.current) {
                        onFire();
                    }
                } else {
                    setAutoNextCountdown(remaining);
                }
            }, 1000);
        },
        [clearCountdownTimer]
    );

    // Clean up timer on unmount
    useEffect(() => {
        return () => {
            clearCountdownTimer();
        };
    }, [clearCountdownTimer]);

    return {
        isTransitioning,
        autoNextCountdown,
        guardedNav,
        startTransition,
        clearTransition,
        cancelAutoNext,
        startAutoNextCountdown,
        isTransitioningRef,
    };
}
