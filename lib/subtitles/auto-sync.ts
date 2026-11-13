/**
 * Subtitle auto-sync: fits a subtitle's cue timing to when people actually speak.
 *
 * Same idea as Harbor (speech activity from the audio) and Nuvio (offset plus a
 * whole-film frame-rate scale, applied only when the match is confident): build an
 * on/off timeline from the cues, slide it over the speech timeline, and keep the
 * best transform only if it clearly beats every distinct alternative. A wrong fit
 * is worse than none, so ambiguous results return null.
 *
 * Pure module: no DOM, network or player access.
 */

export interface Cue {
    /** Seconds, as written in the subtitle file. */
    start: number;
    end: number;
    text: string;
}

/** Displayed time = original × scale + offset. */
export interface SubtitleTiming {
    offsetMs: number;
    scale: number;
}

/** Speech on/off per BIN seconds, starting at `start` (media time). */
export interface SpeechWindow {
    start: number;
    bins: Uint8Array;
}

export interface SyncFit extends SubtitleTiming {
    score: number;
}

export const BIN = 0.1;
const MAX_OFFSET_S = 60;
const MIN_SCORE = 0.2;
const MIN_MARGIN = 1.25;
const DISTINCT_S = 3;
const MAX_CUE_S = 12;
// Common PAL/NTSC/film mismatches between a subtitle's source and the video.
const SCALES = [1, 25 / 23.976, 23.976 / 25, 25 / 24, 24 / 25, 24 / 23.976, 23.976 / 24];

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSeconds = (raw: string): number | null => {
    const m = TIME.exec(raw);
    if (!m) return null;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
};

/** WebVTT / SRT → cues (markup stripped). */
export function parseCues(text: string): Cue[] {
    const cues: Cue[] = [];
    for (const block of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
        const lines = block.split("\n");
        const timingIndex = lines.findIndex((l) => l.includes("-->"));
        if (timingIndex < 0) continue;
        const [a, b] = lines[timingIndex].split("-->");
        const start = toSeconds(a);
        const end = toSeconds(b);
        if (start == null || end == null || end <= start) continue;
        const body = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>|\{\\[^}]*\}/g, "").trim();
        if (body) cues.push({ start, end: Math.min(end, start + MAX_CUE_S), text: body });
    }
    return cues.sort((x, y) => x.start - y.start);
}

export const applyTiming = (seconds: number, t: SubtitleTiming) => seconds * t.scale + t.offsetMs / 1000;

/** Cue activity on the subtitle's own clock, BIN resolution. */
function cueActivity(cues: Cue[]): Uint8Array {
    const length = Math.ceil((cues.at(-1)?.end ?? 0) / BIN) + 1;
    const bins = new Uint8Array(length);
    for (const c of cues) bins.fill(1, Math.floor(c.start / BIN), Math.ceil(c.end / BIN));
    return bins;
}

/** Phi correlation between speech and the subtitle mapped through (scale, offset). */
function score(windows: SpeechWindow[], activity: Uint8Array, scale: number, offset: number): number {
    let n = 0, both = 0, speech = 0, subs = 0;
    for (const w of windows) {
        for (let i = 0; i < w.bins.length; i++) {
            const original = (w.start + i * BIN - offset) / scale;
            const j = Math.round(original / BIN);
            const sub = j >= 0 && j < activity.length ? activity[j] : 0;
            const sp = w.bins[i];
            n++;
            speech += sp;
            subs += sub;
            both += sp & sub;
        }
    }
    const denominator = Math.sqrt(speech * (n - speech) * subs * (n - subs));
    return denominator ? (n * both - speech * subs) / denominator : 0;
}

/**
 * Best (scale, offset) mapping the cues onto the speech timeline, or null when no
 * candidate is confident and clearly ahead of a different-looking alternative.
 */
export function fitToSpeech(cues: Cue[], windows: SpeechWindow[]): SyncFit | null {
    if (cues.length < 20 || windows.length === 0) return null;
    const activity = cueActivity(cues);
    const mid = windows[Math.floor(windows.length / 2)].start;
    const candidates: SyncFit[] = [];
    for (const scale of SCALES) {
        for (let k = -MAX_OFFSET_S / BIN; k <= MAX_OFFSET_S / BIN; k++) {
            candidates.push({ scale, offsetMs: Math.round(k * BIN * 1000), score: score(windows, activity, scale, k * BIN) });
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < MIN_SCORE) return null;
    // Where the two transforms put the middle of the analysed range: far apart = distinct answer.
    const at = (t: SyncFit) => applyTiming(mid / t.scale, t);
    const rival = candidates.find((c) => Math.abs(at(c) - at(best)) > DISTINCT_S);
    if (rival && rival.score > 0 && best.score / rival.score < MIN_MARGIN) return null;
    return best;
}

/** Shift so `cue` shows `reactionS` before `nowS` — "the line I just heard". */
export function timingFromHeardLine(cue: Cue, nowS: number, current: SubtitleTiming, reactionS = 0.3): SubtitleTiming {
    return { scale: current.scale, offsetMs: Math.round((nowS - reactionS - cue.start * current.scale) * 1000) };
}

export const isIdentity = (t: SubtitleTiming | undefined) => !t || (Math.abs(t.offsetMs) < 150 && Math.abs(t.scale - 1) < 1e-4);

export function formatTiming(t: SubtitleTiming | undefined): string {
    if (isIdentity(t)) return "In sync";
    const s = t!.offsetMs / 1000;
    const fps = Math.abs(t!.scale - 1) > 1e-4 ? " · frame rate fixed" : "";
    return `${s > 0 ? "+" : ""}${s.toFixed(1)}s${fps}`;
}
