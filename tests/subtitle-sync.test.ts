import { describe, expect, test } from "bun:test";
import { BIN, fitToSpeech, parseCues, timingFromHeardLine, type Cue, type SpeechWindow } from "@/lib/subtitles/auto-sync";

// Deterministic pseudo-random so the test is stable.
function rng(seed: number) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Dialogue on the video's clock: irregular lines and pauses over ~22 minutes. */
function dialogue(seed: number): Cue[] {
    const r = rng(seed);
    const cues: Cue[] = [];
    for (let t = 5; t < 1350; ) {
        const len = 0.8 + r() * 3.5;
        cues.push({ start: t, end: t + len, text: "line" });
        t += len + 0.3 + r() * (r() < 0.15 ? 12 : 2.5);
    }
    return cues;
}

/** Speech windows as the device would hear them: the truth, with VAD noise. */
function speech(truth: Cue[], seed: number): SpeechWindow[] {
    const r = rng(seed);
    return [0.3, 0.5, 0.7].map((p) => {
        const start = 1350 * p - 20;
        const bins = new Uint8Array(400);
        for (let i = 0; i < bins.length; i++) {
            const t = start + i * BIN;
            const talking = truth.some((c) => t >= c.start && t < c.end);
            bins[i] = (r() < 0.12 ? !talking : talking) ? 1 : 0; // 12% of bins wrong
        }
        return { start, bins };
    });
}

describe("subtitle auto-sync", () => {
    const truth = dialogue(7);

    test("finds a constant delay", () => {
        const late = truth.map((c) => ({ ...c, start: c.start + 2.4, end: c.end + 2.4 }));
        const fit = fitToSpeech(late, speech(truth, 1));
        expect(fit).not.toBeNull();
        expect(fit!.scale).toBe(1);
        expect(Math.abs(fit!.offsetMs + 2400)).toBeLessThanOrEqual(200);
    });

    test("finds frame-rate drift plus offset", () => {
        // Subtitle made for a 25 fps release, video is 23.976: displayed = original × 25/23.976.
        const scale = 25 / 23.976;
        const drifted = truth.map((c) => ({ ...c, start: (c.start - 1.5) / scale, end: (c.end - 1.5) / scale }));
        const fit = fitToSpeech(drifted, speech(truth, 2));
        expect(fit).not.toBeNull();
        expect(fit!.scale).toBeCloseTo(scale, 4);
        expect(Math.abs(fit!.offsetMs - 1500)).toBeLessThanOrEqual(300);
    });

    test("refuses a subtitle for something else", () => {
        expect(fitToSpeech(dialogue(99), speech(truth, 3))).toBeNull();
    });

    test("parses SRT and VTT timing", () => {
        const cues = parseCues("1\n00:00:01,500 --> 00:00:03,000\nHello <i>there</i>\n\n00:01:02.250 --> 00:01:04.000\nBye");
        expect(cues).toEqual([
            { start: 1.5, end: 3, text: "Hello there" },
            { start: 62.25, end: 64, text: "Bye" },
        ]);
    });

    test("heard line shifts the cue to just before now", () => {
        const t = timingFromHeardLine({ start: 10, end: 12, text: "x" }, 14.3, { offsetMs: 0, scale: 1 });
        expect(t.offsetMs).toBe(4000);
    });
});
