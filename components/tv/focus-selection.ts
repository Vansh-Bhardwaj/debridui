export type Direction = "left" | "right" | "up" | "down";
type Rect = { left: number; top: number; width: number; height: number };

export function closestInDirection(current: Rect, items: Rect[], direction: Direction): number {
    const horizontal = direction === "left" || direction === "right";
    const cx = current.left + current.width / 2;
    const cy = current.top + current.height / 2;
    let best = -1;
    let bestScore = Infinity;
    items.forEach((item, index) => {
        const dx = item.left + item.width / 2 - cx;
        const dy = item.top + item.height / 2 - cy;
        const forward = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
        if (forward <= 10) return;
        const across = Math.abs(horizontal ? dy : dx);
        const overlaps = horizontal
            ? item.top < current.top + current.height && item.top + item.height > current.top
            : item.left < current.left + current.width && item.left + item.width > current.left;
        const score = forward + across * 3 + (overlaps ? 0 : 10000);
        if (score < bestScore) { best = index; bestScore = score; }
    });
    return best;
}

export function restoreFocusIndex(items: { key: string }[], saved?: { key: string; index: number }): number {
    if (!items.length) return -1;
    if (!saved) return 0;
    const match = items.findIndex((item) => item.key === saved.key);
    return match >= 0 ? match : Math.min(saved.index, items.length - 1);
}
