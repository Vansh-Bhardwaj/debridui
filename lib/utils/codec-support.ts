/**
 * Browser codec support detection utilities
 * Helps determine which audio/video formats can be played natively
 */

export interface CodecSupport {
    h264: boolean;
    hevc: boolean;
    vp9: boolean;
    av1: boolean;
    aac: boolean;
    ac3: boolean;
    eac3: boolean;
    dts: boolean;
    opus: boolean;
    flac: boolean;
    mp3: boolean;
    truehd: boolean;
}

// Common problematic audio codecs in MKV/video files
const _PROBLEMATIC_AUDIO_CODECS = ["ac3", "ac-3", "eac3", "e-ac-3", "dts", "truehd", "dtshd"];

// File extensions that commonly contain problematic codecs
const PROBLEMATIC_EXTENSIONS = [".mkv", ".avi", ".wmv", ".flv"];

/**
 * Check if we're on iOS
 */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Check if we're on Safari (including iOS Safari)
 */
export function isSafari(): boolean {
    if (typeof navigator === "undefined") return false;
    return /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
}

/**
 * Check if the browser supports a specific MIME type
 */
function canPlayType(mimeType: string): boolean {
    if (typeof document === "undefined") return false;
    const video = document.createElement("video");
    const result = video.canPlayType(mimeType);
    return result === "probably" || result === "maybe";
}

/**
 * Detect browser codec support
 * Note: This is a best-effort detection and may not be 100% accurate
 */
export function detectCodecSupport(): CodecSupport {
    return {
        // Video codecs
        h264: canPlayType('video/mp4; codecs="avc1.42E01E"'),
        hevc: canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') || canPlayType('video/mp4; codecs="hev1.1.6.L120.90"'),
        vp9: canPlayType('video/webm; codecs="vp9"'),
        av1: canPlayType('video/mp4; codecs="av01.0.05M.08"'),
        
        // Audio codecs
        aac: canPlayType('audio/mp4; codecs="mp4a.40.2"'),
        ac3: canPlayType('audio/mp4; codecs="ac-3"'),
        eac3: canPlayType('audio/mp4; codecs="ec-3"') || canPlayType('audio/mp4; codecs="eac3"'),
        dts: canPlayType('audio/mp4; codecs="dts"') || canPlayType('audio/mp4; codecs="dtsc"'),
        opus: canPlayType('audio/webm; codecs="opus"'),
        flac: canPlayType('audio/flac'),
        mp3: canPlayType('audio/mpeg'),
        truehd: canPlayType('audio/mp4; codecs="mlpa"'),
    };
}

/**
 * Check if a file extension likely has codec compatibility issues
 */
export function hasLikelyCodecIssues(filename: string): boolean {
    const lower = filename.toLowerCase();
    return PROBLEMATIC_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Get a description of potentially problematic codecs
 */
export function getCodecCompatibilityInfo(): { supported: string[]; unsupported: string[] } {
    const support = detectCodecSupport();
    const supported: string[] = [];
    const unsupported: string[] = [];

    // Video
    if (support.h264) supported.push("H.264"); else unsupported.push("H.264");
    if (support.hevc) supported.push("HEVC/H.265"); else unsupported.push("HEVC/H.265");
    if (support.vp9) supported.push("VP9"); else unsupported.push("VP9");
    if (support.av1) supported.push("AV1"); else unsupported.push("AV1");

    // Audio - the problematic ones
    if (support.aac) supported.push("AAC"); else unsupported.push("AAC");
    if (support.ac3) supported.push("AC3/Dolby Digital"); else unsupported.push("AC3/Dolby Digital");
    if (support.eac3) supported.push("E-AC3/Dolby Digital Plus"); else unsupported.push("E-AC3/Dolby Digital Plus");
    if (support.dts) supported.push("DTS"); else unsupported.push("DTS");
    if (support.truehd) supported.push("Dolby TrueHD"); else unsupported.push("Dolby TrueHD");
    if (support.opus) supported.push("Opus"); else unsupported.push("Opus");

    return { supported, unsupported };
}

/**
 * Determine if transcoded streaming should be preferred over direct download
 * Returns true if the browser likely can't play the file natively
 */
export function shouldPreferTranscodedStream(filename: string): boolean {
    const support = detectCodecSupport();
    const ext = filename.toLowerCase();

    // MKV files often have AC3/DTS audio which most browsers don't support
    if (ext.endsWith(".mkv") && !support.ac3 && !support.dts && !support.eac3) {
        return true;
    }

    // AVI/WMV are legacy formats with poor browser support
    if (ext.endsWith(".avi") || ext.endsWith(".wmv")) {
        return true;
    }

    return false;
}

/**
 * Get the best streaming URL for the current browser
 * Prefers transcoded formats when native playback is unlikely to work
 */
export function selectBestStreamingUrl(
    downloadUrl: string,
    streamingLinks: Record<string, string> | undefined,
    filename: string
): { url: string; isTranscoded: boolean; format: string } {
    // If no streaming links available, use download URL
    if (!streamingLinks || Object.keys(streamingLinks).length === 0) {
        return { url: downloadUrl, isTranscoded: false, format: "direct" };
    }

    const support = detectCodecSupport();
    const shouldTranscode = shouldPreferTranscodedStream(filename);
    const ios = isIOS();
    const safari = isSafari();

    // On iOS/Safari, ALWAYS prefer HLS (apple) format if available
    // iOS Safari has very limited codec support and HLS provides best compatibility
    if (ios || safari) {
        if (streamingLinks.apple) {
            return { url: streamingLinks.apple, isTranscoded: true, format: "HLS" };
        }
        // If no HLS available but this is a problematic format, use liveMP4 if available
        if (shouldTranscode && streamingLinks.liveMP4) {
            return { url: streamingLinks.liveMP4, isTranscoded: true, format: "MP4 (transcoded)" };
        }
        // Fallback: try native streaming link if available (may not work for all files)
        if (streamingLinks.native) {
            return { url: streamingLinks.native, isTranscoded: false, format: "native" };
        }
    }

    // If we should transcode (based on file extension and codec support), try various transcoded formats
    if (shouldTranscode) {
        // Prefer liveMP4 for broad compatibility
        if (streamingLinks.liveMP4) {
            return { url: streamingLinks.liveMP4, isTranscoded: true, format: "MP4 (transcoded)" };
        }
        // Try H.264 WebM
        if (streamingLinks.h264WebM && support.vp9) {
            return { url: streamingLinks.h264WebM, isTranscoded: true, format: "WebM" };
        }
        // Try HLS even on non-Apple if available
        if (streamingLinks.apple) {
            return { url: streamingLinks.apple, isTranscoded: true, format: "HLS" };
        }
        // DASH as last transcoded option
        if (streamingLinks.dash) {
            return { url: streamingLinks.dash, isTranscoded: true, format: "DASH" };
        }
    }

    // Default to direct download
    return { url: downloadUrl, isTranscoded: false, format: "direct" };
}

/**
 * Get iOS-specific playback recommendations
 */
export function getIOSPlaybackRecommendation(filename: string, hasStreamingLinks: boolean, hasAppleLink: boolean): {
    canPlay: "likely" | "maybe" | "unlikely";
    recommendation: string;
} {
    const ext = filename.toLowerCase();
    
    // HLS stream available - should work
    if (hasAppleLink) {
        return {
            canPlay: "likely",
            recommendation: "This video should play in your browser.",
        };
    }
    
    // MP4 with H.264 usually works
    if (ext.endsWith(".mp4")) {
        return {
            canPlay: "maybe",
            recommendation: "This MP4 should play, but audio may not work if it uses AC3/DTS.",
        };
    }
    
    // MKV/AVI rarely work on iOS
    if (ext.endsWith(".mkv") || ext.endsWith(".avi") || ext.endsWith(".wmv")) {
        return {
            canPlay: "unlikely",
            recommendation: "This format doesn't play on iOS Safari. Use VLC or Infuse app.",
        };
    }
    
    // Unknown format
    return {
        canPlay: "maybe",
        recommendation: "This format may not play on iOS. If it fails, use VLC or Infuse app.",
    };
}

/**
 * Check if video playback has audio issues (no audio playing despite video working)
 * This can be used to detect codec issues at runtime
 */
export function createAudioDetector(video: HTMLVideoElement): {
    hasAudio: () => boolean;
    cleanup: () => void;
} {
    let audioDetected = false;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaElementAudioSourceNode | null = null;

    try {
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        source = audioContext.createMediaElementSource(video);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        analyser.fftSize = 256;
    } catch {
        // Audio context creation failed
    }

    return {
        hasAudio: () => {
            if (!analyser) return true; // Assume audio if we can't detect
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            
            // Check if there's any audio signal
            const sum = dataArray.reduce((a, b) => a + b, 0);
            audioDetected = audioDetected || sum > 0;
            
            return audioDetected;
        },
        cleanup: () => {
            source?.disconnect();
            analyser?.disconnect();
            audioContext?.close();
        },
    };
}
