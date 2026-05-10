/**
 * Subtitle sync transform.
 *
 * Maps the player's `video.currentTime` to the corresponding time inside the
 * subtitle file. Three knobs compose:
 *
 *  - `delayMs` (manual nudge, G/H shortcut): constant offset in milliseconds.
 *  - `speed` (rate multiplier): cues in the file are "stretched" to match the
 *    video's timebase. Used when the subtitle was timed for a different
 *    frame-rate (e.g. 25 fps PAL vs 23.976 fps NTSC). Drift grows linearly
 *    with time — a constant delay can never compensate.
 *  - `pointA`, `pointB` (two-point sync): user locks two moments where the
 *    correct offset is known. The offset is linearly interpolated between
 *    them and clamped outside, which handles edit differences that break
 *    the pure-speed model (commercial cuts, director's-cut inserts).
 *
 * Composition:  subtitle_time = (video_time − offset(video_time)) / speed
 *               − delayMs / 1000
 *
 * Where `offset(t)` is either the interpolated anchor offset, a single-anchor
 * constant, or 0. `delayMs` is kept separate so the G/H shortcut still nudges
 * a user's anchor-locked sync without invalidating the anchors themselves.
 */

export interface SubtitleSyncPoint {
    /** Video `currentTime` (seconds) when the user marked this moment. */
    videoAt: number;
    /** Subtitle-file time (seconds) that was playing at that moment, i.e. the
     *  cue time the user expected. Stored so speed changes don't invalidate
     *  the anchor; we re-derive the offset each render. */
    subAt: number;
}

export interface SubtitleSyncState {
    /** Constant delay in ms. Negative means subs appear earlier. */
    delayMs: number;
    /** Rate multiplier applied to the cue-time axis. 1.0 = no change.
     *  25/23.976 ≈ 1.0427 corrects a 25 fps sub for 23.976 fps video. */
    speed: number;
    /** Optional first anchor. Offset = pointA.videoAt − pointA.subAt × speed. */
    pointA?: SubtitleSyncPoint;
    /** Optional second anchor. With both set, offset interpolates linearly. */
    pointB?: SubtitleSyncPoint;
}

export const INITIAL_SUBTITLE_SYNC: SubtitleSyncState = { delayMs: 0, speed: 1 };

/**
 * Offset at the given video time, in seconds. Positive means the subtitle
 * file's clock is that many seconds behind the video clock.
 */
function offsetAt(videoT: number, state: SubtitleSyncState): number {
    const speed = state.speed || 1;
    const { pointA, pointB } = state;
    if (pointA && pointB && pointB.videoAt !== pointA.videoAt) {
        const [first, second] = pointA.videoAt < pointB.videoAt
            ? [pointA, pointB]
            : [pointB, pointA];
        const offFirst = first.videoAt - first.subAt * speed;
        const offSecond = second.videoAt - second.subAt * speed;
        if (videoT <= first.videoAt) return offFirst;
        if (videoT >= second.videoAt) return offSecond;
        const t = (videoT - first.videoAt) / (second.videoAt - first.videoAt);
        return offFirst + (offSecond - offFirst) * t;
    }
    if (pointA) {
        return pointA.videoAt - pointA.subAt * speed;
    }
    if (pointB) {
        return pointB.videoAt - pointB.subAt * speed;
    }
    return 0;
}

/**
 * Map a video time to the subtitle-file time that should be playing.
 */
export function videoToSubtitleTime(videoT: number, state: SubtitleSyncState): number {
    const speed = state.speed || 1;
    const offset = offsetAt(videoT, state);
    const delay = (state.delayMs ?? 0) / 1000;
    return (videoT - offset) / speed - delay;
}

/**
 * Capture the *current* subtitle-file time at `videoAt` into a new anchor,
 * so when the user presses "Set point" the sync reference is whatever they
 * were seeing right then (including any current delay/speed/anchor effect).
 * Exactly the inverse of {@link videoToSubtitleTime}.
 */
export function captureSyncPoint(videoAt: number, state: SubtitleSyncState): SubtitleSyncPoint {
    return { videoAt, subAt: videoToSubtitleTime(videoAt, state) };
}

/**
 * Human-readable summary for UI. Omits defaults.
 */
export function describeSync(state: SubtitleSyncState): string {
    const parts: string[] = [];
    if ((state.delayMs ?? 0) !== 0) parts.push(`delay ${state.delayMs > 0 ? "+" : ""}${state.delayMs}ms`);
    const s = state.speed ?? 1;
    if (Math.abs(s - 1) > 0.0005) parts.push(`speed ${(s * 100).toFixed(1)}%`);
    const anchors = [state.pointA, state.pointB].filter(Boolean).length;
    if (anchors > 0) parts.push(`${anchors} anchor${anchors === 1 ? "" : "s"}`);
    return parts.length ? parts.join(" · ") : "default";
}
