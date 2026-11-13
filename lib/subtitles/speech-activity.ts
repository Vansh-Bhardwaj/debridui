/**
 * Speech timeline from the audio of an HLS stream, decoded on this device.
 *
 * Reads only a few short windows (mid-film, away from intros/credits) of a
 * low-resolution session, so the download stays small (~2 MB per 10 s at 480p).
 * Voice detection is a per-window adaptive energy gate: frames well above the
 * window's quiet floor count as speech, bridged across short pauses.
 */
import { BIN, type SpeechWindow } from "@/lib/subtitles/auto-sync";

const WINDOW_S = 40;
const POSITIONS = [0.3, 0.5, 0.7];
const FRAME_S = 0.02;
const ABOVE_FLOOR_DB = 9;
const HANGOVER_FRAMES = 10; // 200 ms

/** Per-frame loudness (dB) of a mono signal. */
function frameLevels(samples: Float32Array, sampleRate: number): Float32Array {
    const size = Math.round(sampleRate * FRAME_S);
    const levels = new Float32Array(Math.floor(samples.length / size));
    for (let f = 0; f < levels.length; f++) {
        let sum = 0;
        for (let i = f * size; i < (f + 1) * size; i++) sum += samples[i] * samples[i];
        levels[f] = 10 * Math.log10(sum / size + 1e-10);
    }
    return levels;
}

function speechBins(levels: Float32Array): Uint8Array {
    const sorted = Float32Array.from(levels).sort();
    const floor = sorted[Math.floor(sorted.length * 0.2)] ?? -90;
    const gate = Math.max(floor + ABOVE_FLOOR_DB, -55);
    const voiced = new Uint8Array(levels.length);
    let hang = 0;
    for (let f = 0; f < levels.length; f++) {
        if (levels[f] > gate) hang = HANGOVER_FRAMES;
        voiced[f] = hang > 0 ? 1 : 0;
        hang--;
    }
    const perBin = Math.round(BIN / FRAME_S);
    const bins = new Uint8Array(Math.floor(voiced.length / perBin));
    for (let b = 0; b < bins.length; b++) {
        let on = 0;
        for (let f = b * perBin; f < (b + 1) * perBin; f++) on += voiced[f];
        bins[b] = on * 2 >= perBin ? 1 : 0;
    }
    return bins;
}

export async function readSpeechWindows(hlsUrl: string, duration: number, signal: AbortSignal): Promise<SpeechWindow[]> {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.UrlSource(hlsUrl), formats: mb.HLS_FORMATS });
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track || !(await track.canDecode())) return [];
        // HLS timestamps can start above zero; subtitles are timed from the first frame.
        const origin = await track.getFirstTimestamp();
        const sink = new mb.AudioSampleSink(track);
        const windows: SpeechWindow[] = [];
        for (const position of POSITIONS) {
            const start = Math.max(0, duration * position - WINDOW_S / 2);
            let rate = 0;
            const chunks: Float32Array[] = [];
            for await (const sample of sink.samples(origin + start, origin + start + WINDOW_S)) {
                if (signal.aborted) {
                    sample.close();
                    return [];
                }
                const buffer = sample.toAudioBuffer();
                rate = buffer.sampleRate;
                const mono = new Float32Array(buffer.length);
                for (let c = 0; c < buffer.numberOfChannels; c++) {
                    const data = buffer.getChannelData(c);
                    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
                }
                chunks.push(mono);
                sample.close();
            }
            if (!rate || chunks.length === 0) continue;
            const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
            chunks.reduce((at, c) => (all.set(c, at), at + c.length), 0);
            windows.push({ start, bins: speechBins(frameLevels(all, rate)) });
        }
        return windows;
    } finally {
        input.dispose();
    }
}
