/**
 * Apple's native player only shows subtitles that are part of the HLS stream.
 * Wrap the provider's playlist in a master playlist (served by the CORS proxy
 * worker, /hls) that adds each addon subtitle as a WebVTT rendition, so they
 * show up in the Subtitles menu of Apple's fullscreen player.
 */
import type { AddonSubtitle } from "@/lib/addons/types";
import { getSignedProxyUrl } from "@/lib/signed-proxy";
import { getSubtitleLabel, isSubtitleLanguage } from "@/lib/utils/subtitles";

const MAX_TRACKS = 10;

/** Preferred language first, then English, then the rest — deduped, capped. */
export function pickNativeSubtitles(subtitles: AddonSubtitle[] | undefined, preferredLang: string): AddonSubtitle[] {
    const seen = new Set<string>();
    const withUrl = (subtitles ?? []).filter((s) => s.url && !seen.has(s.url) && seen.add(s.url));
    const rank = (s: AddonSubtitle) => (isSubtitleLanguage(s, preferredLang) ? 0 : isSubtitleLanguage(s, "english") ? 1 : 2);
    return withUrl.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).slice(0, MAX_TRACKS).map(({ s }) => s);
}

const toBase64Url = (text: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function buildNativeHlsUrl(hlsUrl: string, subtitles: AddonSubtitle[], preferredLang: string): Promise<string> {
    if (subtitles.length === 0) return hlsUrl;
    const [master, ...vtts] = await Promise.all([
        getSignedProxyUrl("hls", hlsUrl),
        ...subtitles.map((s) => getSignedProxyUrl("vtt", s.url)),
    ]);
    const tracks = subtitles.map((s, i) => ({
        u: vtts[i],
        l: s.lang,
        n: getSubtitleLabel(s),
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
export async function isPlaylistReachable(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        return res.ok && (await res.text()).startsWith("#EXTM3U");
    } catch {
        return false;
    }
}
