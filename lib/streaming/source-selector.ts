import { type AddonSource } from "@/lib/addons/types";
import { getResolutionIndex, getSourceQualityIndex } from "@/lib/addons/parser";
import { type QualityRange, type StreamingSettings, getActiveRange } from "@/lib/stores/settings";
import { type CodecSupport } from "@/lib/utils/codec-support";

const LANGUAGE_PATTERNS: Record<string, RegExp> = {
    english: /\b(eng|english|en)\b/i,
    spanish: /\b(esp|spanish|español|spa|es)\b/i,
    french: /\b(french|français|fra|fr)\b/i,
    german: /\b(german|deutsch|ger|de)\b/i,
    italian: /\b(italian|italiano|ita|it)\b/i,
    portuguese: /\b(portuguese|português|por|pt)\b/i,
    russian: /\b(russian|русский|rus|ru)\b/i,
    japanese: /\b(japanese|日本語|jpn|ja)\b/i,
    korean: /\b(korean|한국어|kor|ko)\b/i,
    chinese: /\b(chinese|中文|chi|zh)\b/i,
    hindi: /\b(hindi|हिन्दी|hin|hi)\b/i,
    arabic: /\b(arabic|العربية|ara|ar)\b/i,
};

const SIZE_PATTERN = /([\d.]+)\s*(GB|MB|KB)?/i;

function matchesResolutionRange(source: AddonSource, range: QualityRange): boolean {
    if (!source.resolution) return true; // Unknown resolution passes

    const sourceIndex = getResolutionIndex(source.resolution);
    // Lower index = better resolution
    const minIndex = range.maxResolution === "any" ? 0 : getResolutionIndex(range.maxResolution);
    const maxIndex = range.minResolution === "any" ? Infinity : getResolutionIndex(range.minResolution);

    return sourceIndex >= minIndex && sourceIndex <= maxIndex;
}

function matchesSourceQualityRange(source: AddonSource, range: QualityRange): boolean {
    if (!source.quality) return true; // Unknown quality passes

    const sourceIndex = getSourceQualityIndex(source.quality);
    // Lower index = better quality
    const minIndex = range.maxSourceQuality === "any" ? 0 : getSourceQualityIndex(range.maxSourceQuality);
    const maxIndex = range.minSourceQuality === "any" ? Infinity : getSourceQualityIndex(range.minSourceQuality);

    return sourceIndex >= minIndex && sourceIndex <= maxIndex;
}

/**
 * Language detection from source title/name
 */
function detectLanguage(source: AddonSource): string | null {
    const text = (source.title || source.description || "").toLowerCase();

    for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
        if (pattern.test(text)) return lang;
    }

    return null;
}

// ── Codec Detection from Source Titles ─────────────────────────────────
// Many torrent/debrid sources advertise codecs in the release title.
// We detect these to penalize sources the browser can't play.

type DetectedAudioCodec = "dts" | "truehd" | "eac3" | "ac3" | "aac" | "opus" | "flac" | null;
type DetectedVideoCodec = "hevc" | "av1" | "h264" | null;

const AUDIO_CODEC_PATTERNS: [DetectedAudioCodec, RegExp][] = [
    // Order matters: more specific patterns first
    ["truehd", /\b(truehd|true[\s._-]?hd|mlp)\b/i],
    ["dts", /\b(dts[\s._-]?(?:hd|x|ma|hd[\s._-]?ma)?|dts)\b/i],
    ["eac3", /\b(e[\s._-]?ac[\s._-]?3|eac3|dd[\s._-]?\+|ddp(?:5\.1|7\.1|atmos)?|dolby[\s._-]?digital[\s._-]?plus|atmos)\b/i],
    ["ac3", /\b(ac[\s._-]?3|dd[\s._-]?(?:5\.1|7\.1|2\.0)|dolby[\s._-]?digital(?![\s._-]?plus))\b/i],
    ["flac", /\b(flac)\b/i],
    ["opus", /\b(opus)\b/i],
    ["aac", /\b(aac(?:[\s._-]?(?:2\.0|5\.1|lc))?)\b/i],
];

const VIDEO_CODEC_PATTERNS: [DetectedVideoCodec, RegExp][] = [
    ["hevc", /\b(hevc|h[\s._-]?265|x[\s._-]?265)\b/i],
    ["av1", /\b(av1|av01)\b/i],
    ["h264", /\b(h[\s._-]?264|x[\s._-]?264|avc)\b/i],
];

/** Detect audio codec from source title/description. Returns null if ambiguous. */
export function detectAudioCodec(source: AddonSource): DetectedAudioCodec {
    const text = `${source.title || ""} ${source.description || ""}`;
    for (const [codec, pattern] of AUDIO_CODEC_PATTERNS) {
        if (pattern.test(text)) return codec;
    }
    return null;
}

/** Detect video codec from source title/description. Returns null if ambiguous. */
export function detectVideoCodec(source: AddonSource): DetectedVideoCodec {
    const text = `${source.title || ""} ${source.description || ""}`;
    for (const [codec, pattern] of VIDEO_CODEC_PATTERNS) {
        if (pattern.test(text)) return codec;
    }
    return null;
}

/**
 * Calculate codec compatibility penalty.
 * Higher = worse (incompatible). 0 = fine or unknown.
 * Deliberately high values so incompatible sources sink below compatible ones,
 * but never filtered out entirely (so you're not stuck with "no sources").
 */
function codecPenalty(source: AddonSource, support: CodecSupport | undefined): number {
    if (!support) return 0; // No codec info (e.g. external player target) → no penalty

    let penalty = 0;

    // ── Audio codec penalty ──
    const audio = detectAudioCodec(source);
    switch (audio) {
        case "dts":
            if (!support.dts) penalty += 100;
            break;
        case "truehd":
            if (!support.truehd) penalty += 100;
            break;
        case "eac3":
            if (!support.eac3) penalty += 80;
            break;
        case "ac3":
            if (!support.ac3) penalty += 80;
            break;
        case "aac":
            // AAC is universally supported — give a small bonus
            penalty -= 5;
            break;
        case "opus":
            if (!support.opus) penalty += 40;
            break;
        case "flac":
            if (!support.flac) penalty += 40;
            break;
        case null:
            // Unknown audio codec — no penalty, no bonus (ambiguous)
            break;
    }

    // ── Video codec penalty ──
    const video = detectVideoCodec(source);
    switch (video) {
        case "hevc":
            if (!support.hevc) penalty += 60;
            break;
        case "av1":
            if (!support.av1) penalty += 60;
            break;
        case "h264":
            // H.264 is universally supported — small bonus
            penalty -= 3;
            break;
        case null:
            break;
    }

    return penalty;
}

// ── Source title affinity (fingerprint matching) ───────────────────────

const SOURCE_NOISE_TOKENS = new Set([
    "the", "and", "for", "with", "from", "1080p", "2160p", "720p", "480p", "x264", "x265",
    "hevc", "h264", "web", "webrip", "webdl", "bluray", "remux", "proper", "repack", "aac", "ac3",
]);

function tokenizeSourceTitle(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/s\d{1,2}e\d{1,2}/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((token) => token.length >= 3 && !SOURCE_NOISE_TOKENS.has(token));
}

function sourceAffinityScore(source: AddonSource, preferredTitle?: string): number {
    if (!preferredTitle) return 0;
    const currentTokens = new Set(tokenizeSourceTitle(`${source.title} ${source.description ?? ""}`));
    if (currentTokens.size === 0) return 0;

    const preferredTokens = tokenizeSourceTitle(preferredTitle);
    if (preferredTokens.length === 0) return 0;

    let overlap = 0;
    for (const token of preferredTokens) {
        if (currentTokens.has(token)) overlap++;
    }

    const ratio = overlap / preferredTokens.length;
    if (ratio >= 0.45) return -40;
    if (ratio >= 0.28) return -22;
    if (ratio >= 0.18) return -10;
    return 0;
}

/**
 * Calculate a score for source ranking
 * Lower score = better source
 */
function calculateScore(
    source: AddonSource,
    options: {
        preferredLanguage?: string;
        preferredAddon?: string;
        preferCached?: boolean;
        preferredSourceTitle?: string;
        preferredSourceResolution?: string;
        preferredSourceQuality?: string;
        originalLanguage?: string;
        codecSupport?: CodecSupport;
        preferredBingeGroup?: string;
    } = {}
): number {
    let score = 0;

    // Resolution score (0-6, lower = better)
    score += getResolutionIndex(source.resolution) * 10;

    // Quality score (0-4, lower = better)
    score += getSourceQualityIndex(source.quality) * 5;

    // Cached bonus (-50 points)
    if (source.isCached && options.preferCached !== false) {
        score -= 50;
    }

    // ── Binge pack affinity (-60 points) ──
    // When binge-watching, strongly prefer sources from the same torrent pack.
    // This guarantees same codec, same quality, same audio across a whole season.
    if (options.preferredBingeGroup && source.bingeGroup) {
        if (source.bingeGroup === options.preferredBingeGroup) {
            score -= 60;
        }
    }

    // Preferred language bonus (-20 points)
    if (options.preferredLanguage) {
        const lang = detectLanguage(source);
        if (lang === options.preferredLanguage.toLowerCase()) {
            score -= 20;
        }
    }

    // Original language bonus — prefer sources containing the show's native audio
    if (options.originalLanguage) {
        const lang = detectLanguage(source);
        const text = (source.title || source.description || "").toLowerCase();
        if (lang === options.originalLanguage.toLowerCase()) {
            score -= 25; // Direct match: source is in original language
        } else if (/\b(multi|dual[\s-]?audio|dual)\b/.test(text)) {
            score -= 10; // Multi/dual audio likely includes original
        }
    }

    // Preferred addon bonus (-15 points) - for sources from same addon as subtitles
    if (options.preferredAddon && source.addonId === options.preferredAddon) {
        score -= 15;
    }

    // Prefer the same source fingerprint the user manually selected before.
    score += sourceAffinityScore(source, options.preferredSourceTitle);

    if (options.preferredSourceResolution && source.resolution === options.preferredSourceResolution) {
        score -= 12;
    }

    if (options.preferredSourceQuality && source.quality === options.preferredSourceQuality) {
        score -= 10;
    }

    // Size tiebreaker — prefer larger files (higher bitrate) with diminishing returns.
    // Log2 scaling prevents absurdly large (possibly fake) files from dominating,
    // and the cap of 3 ensures size never overrides a resolution tier (10) or quality tier (5).
    if (source.size) {
        const sizeMatch = source.size.match(SIZE_PATTERN);
        if (sizeMatch) {
            let sizeGB = parseFloat(sizeMatch[1]);
            const unit = (sizeMatch[2] || "GB").toUpperCase();
            if (unit === "MB") sizeGB /= 1024;
            if (unit === "KB") sizeGB /= (1024 * 1024);
            if (sizeGB > 0) {
                score -= Math.min(Math.log2(sizeGB + 1) * 0.5, 3);
            }
        }
    }

    // ── Codec compatibility penalty ──
    // Heavily penalize sources the browser can't play (DTS, AC3, HEVC on unsupported devices).
    // This is applied last so it acts as a strong override without interfering with other factors.
    score += codecPenalty(source, options.codecSupport);

    return score;
}

export interface SelectionResult {
    source: AddonSource | null;
    isCached: boolean;
    hasMatches: boolean;
    cachedMatches: AddonSource[];
    uncachedMatches: AddonSource[];
    allSorted: AddonSource[];
}

export interface SelectionOptions {
    preferredLanguage?: string;
    preferredAddon?: string;
    preferCached?: boolean;
    preferredSourceTitle?: string;
    preferredSourceResolution?: string;
    preferredSourceQuality?: string;
    originalLanguage?: string;
    /** Browser codec support — pass undefined to skip codec penalties (e.g. external player). */
    codecSupport?: CodecSupport;
    /** Stremio bingeGroup from the previously played episode for same-pack affinity. */
    preferredBingeGroup?: string;
}

export function selectBestSource(
    sources: AddonSource[],
    settings: StreamingSettings,
    options: SelectionOptions = {}
): SelectionResult {
    const range = getActiveRange(settings);

    // Filter sources that match preferences
    const matchingSources = sources.filter(
        (source) =>
            source.url && // Must have a playable URL
            matchesResolutionRange(source, range) &&
            matchesSourceQualityRange(source, range)
    );

    // Separate cached and uncached
    const cachedMatches = matchingSources.filter((s) => s.isCached);
    const uncachedMatches = matchingSources.filter((s) => !s.isCached);

    const scoreCache = new Map<string, number>();
    const getScore = (source: AddonSource) => {
        const key = source.url || `${source.addonId || ""}-${source.title || ""}`;
        const cached = scoreCache.get(key);
        if (cached !== undefined) return cached;
        const next = calculateScore(source, options);
        scoreCache.set(key, next);
        return next;
    };

    // Sort by calculated score (lower = better)
    const sortByScore = (a: AddonSource, b: AddonSource) => {
        return getScore(a) - getScore(b);
    };

    cachedMatches.sort(sortByScore);
    uncachedMatches.sort(sortByScore);

    // All sources sorted by score (cached bonus naturally ranks them higher)
    const allSorted = [...matchingSources].sort(sortByScore);

    // Prefer cached sources
    if (cachedMatches.length > 0) {
        return {
            source: cachedMatches[0],
            isCached: true,
            hasMatches: true,
            cachedMatches,
            uncachedMatches,
            allSorted,
        };
    }

    // Fallback to uncached if allowed
    if (uncachedMatches.length > 0 && settings.allowUncached) {
        return {
            source: uncachedMatches[0],
            isCached: false,
            hasMatches: true,
            cachedMatches,
            uncachedMatches,
            allSorted,
        };
    }

    return {
        source: null,
        isCached: false,
        hasMatches: false,
        cachedMatches: [],
        uncachedMatches: [],
        allSorted: [],
    };
}

/**
 * Get alternative sources for in-player source switching
 * Returns up to `limit` sources excluding the currently playing one
 */
export function selectAlternativeSources(
    sources: AddonSource[],
    settings: StreamingSettings,
    currentSourceUrl: string,
    limit: number = 5,
    options: SelectionOptions = {}
): AddonSource[] {
    const result = selectBestSource(sources, settings, options);

    // Filter out current source and return alternatives
    return result.allSorted
        .filter((s) => s.url !== currentSourceUrl)
        .slice(0, limit);
}

/**
 * Format source for display in source selection UI
 */
export function formatSourceLabel(source: AddonSource): string {
    const parts: string[] = [];

    if (source.resolution) parts.push(source.resolution);
    if (source.quality) parts.push(source.quality);
    if (source.isCached) parts.push("⚡");

    const lang = detectLanguage(source);
    if (lang) parts.push(lang.toUpperCase().slice(0, 3));

    if (source.addonName) parts.push(`[${source.addonName}]`);

    return parts.join(" • ") || source.title || "Unknown Source";
}
