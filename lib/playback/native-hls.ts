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
