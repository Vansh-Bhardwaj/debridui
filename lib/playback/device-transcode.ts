/**
 * On-device audio conversion for files the browser can't play natively.
 *
 * Chrome decodes H.264/HEVC video in MKV fine but has no Dolby (AC-3/E-AC-3)
 * audio decoder, so those files play silently. This pipeline:
 *
 *   debrid URL ──range reads──▶ Mediabunny demuxer (MKV/MP4/…)
 *        video packets ─copied untouched────────────────┐
 *        audio packets ─FFmpeg AC-3/E-AC-3 (WASM)       │
 *                      └▶ WebCodecs AAC/Opus encoder ───┤
 *                                          fragmented MP4 ▼
 *                                   MediaSource ▶ <video>
 *
 * Everything runs on the viewer's device: no server, no Cloudflare requests,
 * original video quality (incl. HDR) is preserved. Requires the file host to
 * allow cross-origin range requests (most debrid CDNs do).
 */

import type { Conversion, Input, InputAudioTrack, InputVideoTrack } from "mediabunny";

export interface DeviceAudioTrack {
    index: number;
    codec: string;
    language: string;
    channels: number;
    label: string;
}

export interface DeviceTranscodeSession {
    /** Object URL to assign to the <video> element. */
    url: string;
    audioTracks: DeviceAudioTrack[];
    activeAudioIndex: number;
    /** Restart conversion with another audio track at the current position. */
    switchAudio: (index: number) => Promise<void>;
    destroy: () => void;
}

export type DeviceTranscodeFailure =
    | "unsupported-browser"
    | "unreachable" // CORS / network: the host doesn't allow cross-origin reads
    | "unsupported-video"
    | "unsupported-audio"
    | "no-media";

export class DeviceTranscodeError extends Error {
    constructor(readonly reason: DeviceTranscodeFailure, message: string) {
        super(message);
    }
}

const BUFFER_AHEAD_SECONDS = 90;
const BUFFER_BEHIND_SECONDS = 30;

// Preferred-language setting names → ISO 639-2 codes used in MKV track headers.
const LANGUAGE_CODES: Record<string, string[]> = {
    english: ["eng", "en"],
    spanish: ["spa", "es"],
    french: ["fre", "fra", "fr"],
    german: ["ger", "deu", "de"],
    italian: ["ita", "it"],
    portuguese: ["por", "pt"],
    russian: ["rus", "ru"],
    japanese: ["jpn", "ja"],
    korean: ["kor", "ko"],
    chinese: ["chi", "zho", "zh"],
    hindi: ["hin", "hi"],
    arabic: ["ara", "ar"],
};

type MediabunnyModule = typeof import("mediabunny");
let modulePromise: Promise<MediabunnyModule> | null = null;

/** Lazy-load Mediabunny + FFmpeg AC-3 decoder only when a conversion is needed. */
function loadMediabunny(): Promise<MediabunnyModule> {
    modulePromise ??= Promise.all([import("mediabunny"), import("@mediabunny/ac3")]).then(([mb, ac3]) => {
        ac3.registerAc3Decoder();
        return mb;
    });
    return modulePromise;
}

export function isDeviceTranscodeSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.MediaSource !== "undefined" &&
        typeof (window as { AudioEncoder?: unknown }).AudioEncoder !== "undefined" &&
        typeof WebAssembly !== "undefined"
    );
}

function waitFor(target: EventTarget, event: string): Promise<void> {
    return new Promise((resolve) => target.addEventListener(event, () => resolve(), { once: true }));
}

function bufferedAhead(video: HTMLVideoElement): number {
    const t = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= t + 0.5 && video.buffered.end(i) >= t) return video.buffered.end(i) - t;
    }
    return 0;
}

function isBuffered(video: HTMLVideoElement, time: number): boolean {
    for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= time && video.buffered.end(i) - 1 > time) return true;
    }
    return false;
}

function pickAudioTrack(tracks: InputAudioTrack[], preferredLanguage?: string): number {
    const codes = LANGUAGE_CODES[preferredLanguage?.toLowerCase() ?? ""] ?? [];
    const byLang = tracks.findIndex((t) => codes.includes(t.languageCode?.toLowerCase()));
    return byLang >= 0 ? byLang : 0;
}

/**
 * Probe a media URL and start an MSE session that converts its audio on-device.
 * Throws {@link DeviceTranscodeError} when the file/browser/host can't support it.
 */
export async function createDeviceTranscodeSession(
    video: HTMLVideoElement,
    mediaUrl: string,
    options: { startAt?: number; preferredLanguage?: string } = {}
): Promise<DeviceTranscodeSession> {
    if (!isDeviceTranscodeSupported()) {
        throw new DeviceTranscodeError("unsupported-browser", "This browser lacks MediaSource/WebCodecs");
    }
    const mb = await loadMediabunny();

    const input: Input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: new mb.UrlSource(mediaUrl, {
            // Give up fast on CORS-blocked hosts instead of retrying forever.
            getRetryDelay: (attempts) => (attempts < 3 ? attempts + 1 : null),
            parallelism: 2,
        }),
    });

    let videoTrack: InputVideoTrack | null;
    let audioTracks: InputAudioTrack[];
    try {
        [videoTrack, audioTracks] = await Promise.all([input.getPrimaryVideoTrack(), input.getAudioTracks()]);
    } catch (error) {
        input.dispose();
        throw new DeviceTranscodeError("unreachable", `Can't read the file from this host (${String(error)})`);
    }

    if (!videoTrack) {
        input.dispose();
        throw new DeviceTranscodeError("no-media", "No video track found");
    }
    const videoCodec = await videoTrack.getCodecParameterString();
    if (!videoCodec || !MediaSource.isTypeSupported(`video/mp4; codecs="${videoCodec}"`)) {
        input.dispose();
        throw new DeviceTranscodeError("unsupported-video", `Video codec ${videoTrack.codec ?? "unknown"} isn't supported by this browser`);
    }

    const decodable: InputAudioTrack[] = [];
    for (const track of audioTracks) if (await track.canDecode()) decodable.push(track);
    if (decodable.length === 0) {
        input.dispose();
        const codecs = audioTracks.map((t) => t.codec ?? "unknown").join(", ");
        throw new DeviceTranscodeError("unsupported-audio", `No convertible audio track (${codecs || "none"})`);
    }

    const outCodec = (await mb.canEncodeAudio("aac")) ? "aac" : "opus";
    const duration = await input.computeDuration();

    const trackInfo: DeviceAudioTrack[] = decodable.map((t, index) => ({
        index,
        codec: t.codec ?? "unknown",
        language: t.languageCode,
        channels: t.numberOfChannels,
        label: [t.languageCode && t.languageCode !== "und" ? t.languageCode.toUpperCase() : "", t.name].filter(Boolean).join(" · ") || `Track ${index + 1}`,
    }));

    const mediaSource = new MediaSource();
    const url = URL.createObjectURL(mediaSource);
    let sourceBuffer: SourceBuffer | null = null;
    let conversion: Conversion | null = null;
    let generation = 0;
    let destroyed = false;
    let activeAudio = pickAudioTrack(decodable, options.preferredLanguage);

    const appendSafely = async (data: Uint8Array<ArrayBuffer>, gen: number) => {
        const sb = sourceBuffer!;
        // Backpressure: don't decode far beyond the playhead (memory + CPU).
        while (!destroyed && gen === generation && bufferedAhead(video) > BUFFER_AHEAD_SECONDS) {
            await new Promise((r) => setTimeout(r, 500));
        }
        if (destroyed || gen !== generation) return;
        if (sb.updating) await waitFor(sb, "updateend");
        try {
            sb.appendBuffer(data);
        } catch (error) {
            if ((error as DOMException).name !== "QuotaExceededError") throw error;
            // Evict what's already been watched, then retry once.
            const end = Math.max(0, video.currentTime - BUFFER_BEHIND_SECONDS);
            if (end > 0) {
                sb.remove(0, end);
                await waitFor(sb, "updateend");
            }
            sb.appendBuffer(data);
        }
        await waitFor(sb, "updateend");
    };

    const startPipeline = async (startAt: number) => {
        const gen = ++generation;
        const previous = conversion;
        conversion = null;
        if (previous) await previous.cancel().catch(() => {});

        if (sourceBuffer) {
            if (sourceBuffer.updating) sourceBuffer.abort();
            if (sourceBuffer.buffered.length) {
                sourceBuffer.remove(0, Infinity);
                await waitFor(sourceBuffer, "updateend");
            }
            sourceBuffer.timestampOffset = startAt;
        }
        if (destroyed || gen !== generation) return;

        const writable = new WritableStream<{ data: Uint8Array<ArrayBuffer> }>({
            write: async (chunk) => {
                if (destroyed || gen !== generation) return;
                if (!sourceBuffer) {
                    sourceBuffer = mediaSource.addSourceBuffer(await output.getMimeType());
                    sourceBuffer.mode = "segments";
                    sourceBuffer.timestampOffset = startAt;
                }
                await appendSafely(chunk.data, gen);
            },
        });

        const output = new mb.Output({
            format: new mb.Mp4OutputFormat({ fastStart: "fragmented", minimumFragmentDuration: 2 }),
            target: new mb.StreamTarget(writable),
        });

        const chosen = decodable[activeAudio];
        const conv = await mb.Conversion.init({
            input,
            output,
            showWarnings: false,
            trim: startAt > 0 ? { start: startAt } : undefined,
            video: (track) => (track === videoTrack ? {} : { discard: true }),
            // Stereo AAC/Opus is universally encodable via WebCodecs.
            audio: (track) =>
                track === chosen ? { codec: outCodec, numberOfChannels: Math.min(2, track.numberOfChannels) } : { discard: true },
        });
        if (destroyed || gen !== generation) {
            await conv.cancel().catch(() => {});
            return;
        }
        conversion = conv;
        try {
            await conv.execute();
            if (!destroyed && gen === generation && mediaSource.readyState === "open") {
                if (sourceBuffer?.updating) await waitFor(sourceBuffer, "updateend");
                mediaSource.endOfStream();
            }
        } catch (error) {
            if (error instanceof mb.ConversionCanceledError || destroyed || gen !== generation) return;
            console.error("[device-transcode] conversion failed:", error);
            if (mediaSource.readyState === "open") mediaSource.endOfStream("decode");
        }
    };

    // Seeking outside what's been converted restarts the pipeline there.
    const onSeeking = () => {
        if (!destroyed && !isBuffered(video, video.currentTime)) void startPipeline(video.currentTime);
    };

    await new Promise<void>((resolve) => {
        mediaSource.addEventListener(
            "sourceopen",
            () => {
                mediaSource.duration = duration;
                resolve();
            },
            { once: true }
        );
        // The caller assigns `url` to the <video>; open happens after that.
        queueMicrotask(() => {
            if (video.src !== url) video.src = url;
        });
    });

    video.addEventListener("seeking", onSeeking);
    void startPipeline(Math.max(0, options.startAt ?? 0));

    return {
        url,
        audioTracks: trackInfo,
        get activeAudioIndex() {
            return activeAudio;
        },
        switchAudio: async (index) => {
            if (index === activeAudio || !decodable[index]) return;
            activeAudio = index;
            await startPipeline(video.currentTime);
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            generation++;
            video.removeEventListener("seeking", onSeeking);
            void conversion?.cancel().catch(() => {});
            input.dispose();
            URL.revokeObjectURL(url);
        },
    };
}
