/**
 * Time-based scroll tweens (rAF) — smoother than native `scroll-behavior: smooth`
 * for horizontal “flings” and matches app easing (ease-out / premium-like settle).
 */

/** Standard ease-out cubic — quick start, soft landing */
export function easeOutCubic(t: number): number {
    return 1 - (1 - t) ** 3;
}

/** Stronger deceleration — good for longer scroll distances */
export function easeOutQuint(t: number): number {
    return 1 - (1 - t) ** 5;
}

export interface TweenScrollOptions {
    /** Total duration in ms */
    duration?: number;
    /** Easing on normalized time 0..1 */
    easing?: (t: number) => number;
}

/**
 * Tween `element.scrollLeft` toward `targetScrollLeft`, clamped to scroll range.
 * Returns cancel function for overlapping clicks / rapid nav.
 */
export function tweenScrollLeft(
    element: HTMLElement,
    targetScrollLeft: number,
    options?: TweenScrollOptions
): () => void {
    const duration = options?.duration ?? 520;
    const easing = options?.easing ?? easeOutQuint;

    const max = Math.max(0, element.scrollWidth - element.clientWidth);
    const target = Math.max(0, Math.min(max, targetScrollLeft));
    const start = element.scrollLeft;
    const delta = target - start;

    if (Math.abs(delta) < 0.5) {
        element.scrollLeft = target;
        return () => {};
    }

    let raf = 0;
    let cancelled = false;
    const t0 = performance.now();

    const step = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - t0) / duration);
        element.scrollLeft = start + delta * easing(t);
        if (t < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
    };
}
