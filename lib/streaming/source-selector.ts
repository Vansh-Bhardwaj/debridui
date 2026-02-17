import { type AddonSource } from "@/lib/addons/types";
import { getResolutionIndex, getSourceQualityIndex } from "@/lib/addons/parser";
import { type QualityRange, type StreamingSettings, getActiveRange } from "@/lib/stores/settings";

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

    // Preferred language bonus (-20 points)
    if (options.preferredLanguage) {
        const lang = detectLanguage(source);
        if (lang === options.preferredLanguage.toLowerCase()) {
            score -= 20;
        }
    }

    // Preferred addon bonus (-15 points) - for sources from same addon as subtitles
    if (options.preferredAddon && source.addonId === options.preferredAddon) {
        score -= 15;
    }

    // Size consideration - prefer smaller files if similar quality (tie-breaker)
    if (source.size) {
        // Parse size string (e.g., "4.5 GB") to number
        const sizeMatch = source.size.match(SIZE_PATTERN);
        if (sizeMatch) {
            let sizeGB = parseFloat(sizeMatch[1]);
            const unit = (sizeMatch[2] || "GB").toUpperCase();
            if (unit === "MB") sizeGB /= 1024;
            if (unit === "KB") sizeGB /= (1024 * 1024);
            score += Math.min(sizeGB * 0.5, 5);
        }
    }

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

    // All sources sorted for alternative selection UI
    const allSorted = [...cachedMatches, ...uncachedMatches];

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

