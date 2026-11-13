/**
 * Apple's native player only shows subtitles that are part of the HLS stream.
 * Wrap the provider's playlist in a master playlist (served by the CORS proxy
 * worker, /hls) that adds each addon subtitle as a WebVTT rendition, so they
 * show up in the Subtitles menu of Apple's fullscreen player.
 */
import type { AddonSubtitle } from "@/lib/addons/types";
import { getSignedProxyUrl } from "@/lib/signed-proxy";
import { getLanguageDisplayName, isSubtitleLanguage } from "@/lib/utils/subtitles";
import { isIdentity, type SubtitleTiming } from "@/lib/subtitles/auto-sync";

const MAX_TRACKS = 10;
/** Several in the user's language (releases differ in timing), one per other language. */
const MAX_PREFERRED = 4;

/** Preferred language first (up to 4), then one track per other language — deduped, capped. */
export function pickNativeSubtitles(subtitles: AddonSubtitle[] | undefined, preferredLang: string): AddonSubtitle[] {
    const seen = new Set<string>();
    const withUrl = (subtitles ?? []).filter((s) => s.url && !seen.has(s.url) && seen.add(s.url));
    const preferred = withUrl.filter((s) => isSubtitleLanguage(s, preferredLang)).slice(0, MAX_PREFERRED);
    const perLanguage = new Map<string, AddonSubtitle>();
    for (const s of withUrl) {
        const lang = getLanguageDisplayName(s.lang || "und");
        if (!isSubtitleLanguage(s, preferredLang) && !perLanguage.has(lang)) perLanguage.set(lang, s);
    }
    const english = [...perLanguage.values()].filter((s) => isSubtitleLanguage(s, "english"));
    const others = [...perLanguage.values()].filter((s) => !isSubtitleLanguage(s, "english"));
    return [...preferred, ...english, ...others].slice(0, MAX_TRACKS);
}

/**
 * Apple's player merges renditions with the same name (picking one snaps back to
 * the first), so every track gets a distinct name: "English", "English 2", …
 */
export function nativeSubtitleNames(subtitles: AddonSubtitle[]): string[] {
    const counts = new Map<string, number>();
    return subtitles.map((s) => {
        const lang = getLanguageDisplayName(s.lang || "und");
        const n = (counts.get(lang) ?? 0) + 1;
        counts.set(lang, n);
        return n === 1 ? lang : `${lang} ${n}`;
    });
}

const toBase64Url = (text: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Signed WebVTT URL for a subtitle, retimed by the proxy when a sync timing is set. */
export async function signedVttUrl(subtitleUrl: string, timing?: SubtitleTiming): Promise<string> {
    const url = await getSignedProxyUrl("vtt", subtitleUrl);
    return isIdentity(timing) ? url : `${url}&o=${timing!.offsetMs}&s=${timing!.scale.toFixed(6)}`;
}

export async function buildNativeHlsUrl(
    hlsUrl: string,
    subtitles: AddonSubtitle[],
    preferredLang: string,
    timings: Record<string, SubtitleTiming> = {}
): Promise<string> {
    if (subtitles.length === 0) return hlsUrl;
    const [master, ...vtts] = await Promise.all([
        getSignedProxyUrl("hls", hlsUrl),
        ...subtitles.map((s) => signedVttUrl(s.url, timings[s.url])),
    ]);
    const names = nativeSubtitleNames(subtitles);
    const tracks = subtitles.map((s, i) => ({
        u: vtts[i],
        l: s.lang,
        n: names[i],
        d: i === 0 && isSubtitleLanguage(s, preferredLang),
    }));
    return `${master}&subs=${toBase64Url(JSON.stringify(tracks))}`;
}

const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });

/**
 * Resolves true once the provider has produced the stream's first segment
 * (conversions can take a while to start), false if it never does in time.
 * Reads only the first bytes of the segment.
 */
export async function waitForHlsReady(url: string, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!signal.aborted && Date.now() < deadline) {
        try {
            let playlistUrl = url;
            let text = await (await fetch(playlistUrl, { signal })).text();
            // Master playlist → follow the first variant.
            if (text.includes("#EXT-X-STREAM-INF")) {
                playlistUrl = new URL(text.split("\n").find((l) => l.trim() && !l.startsWith("#"))!.trim(), playlistUrl).href;
                text = await (await fetch(playlistUrl, { signal })).text();
            }
            const segment = text.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim();
            if (segment) {
                const res = await fetch(new URL(segment, playlistUrl), { signal });
                if (res.ok && res.body) {
                    const reader = res.body.getReader();
                    const { value } = await reader.read();
                    void reader.cancel();
                    if (value?.length) return true;
                }
            }
        } catch {
            /* not ready yet / transient */
        }
        await sleep(3_000, signal);
    }
    return false;
}

/** Whether a playlist URL answers with a playlist (the subtitle wrapper on the proxy worker). */
export async function isPlaylistReachable(url: string, attempts = 3): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (res.ok && (await res.text()).startsWith("#EXTM3U")) return true;
        } catch {
            /* retry */
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return false;
}
