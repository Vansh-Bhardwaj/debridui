import { AddonSubtitle } from "@/lib/addons/types";

export function getLanguageDisplayName(rawLang: string): string {
    const lang = rawLang.trim();
    // Stremio behavior: if it's not a valid ISO 639-2 code, treat it as display text.
    if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(lang)) return lang;

    const base = lang.split("-")[0]!.toLowerCase();

    const iso639_2_to_1: Record<string, string> = {
        eng: "en",
        spa: "es",
        fra: "fr",
        fre: "fr",
        deu: "de",
        ger: "de",
        ita: "it",
        por: "pt",
        rus: "ru",
        hin: "hi",
        jpn: "ja",
        kor: "ko",
        zho: "zh",
        chi: "zh",
        ara: "ar",
        tur: "tr",
        ukr: "uk",
        pol: "pl",
        nld: "nl",
        dut: "nl",
        swe: "sv",
        nor: "no",
        dan: "da",
        fin: "fi",
        ces: "cs",
        cze: "cs",
        ron: "ro",
        rum: "ro",
        ell: "el",
        gre: "el",
        heb: "he",
        tha: "th",
        vie: "vi",
        ind: "id",
    };

    const bcp47 = base.length === 3 ? iso639_2_to_1[base] ?? base : base;

    try {
        const dn = new Intl.DisplayNames(["en"], { type: "language" });
        return dn.of(bcp47) ?? rawLang;
    } catch {
        return rawLang;
    }
}

export function getSubtitleLabel(sub: AddonSubtitle, addonName?: string): string {
    const hasCustomName = !!sub.name && sub.name.trim().toLowerCase() !== sub.lang.trim().toLowerCase();
    const baseLabel = hasCustomName ? sub.name!.trim() : getLanguageDisplayName(sub.lang);
    return addonName ? `${baseLabel} (${addonName})` : baseLabel;
}

export function isEnglishSubtitle(sub: AddonSubtitle): boolean {
    return isSubtitleLanguage(sub, "english");
}

/** Map of display name → { iso1, iso2, aliases } for subtitle matching */
const LANG_MATCH: Record<string, { iso1: string; iso2: string[]; aliases: string[] }> = {
    english:    { iso1: "en", iso2: ["eng"],           aliases: ["english"] },
    spanish:    { iso1: "es", iso2: ["spa"],           aliases: ["spanish", "español", "espanol"] },
    french:     { iso1: "fr", iso2: ["fra", "fre"],    aliases: ["french", "français", "francais"] },
    german:     { iso1: "de", iso2: ["deu", "ger"],    aliases: ["german", "deutsch"] },
    italian:    { iso1: "it", iso2: ["ita"],           aliases: ["italian", "italiano"] },
    portuguese: { iso1: "pt", iso2: ["por"],           aliases: ["portuguese", "português", "portugues"] },
    russian:    { iso1: "ru", iso2: ["rus"],           aliases: ["russian", "русский"] },
    japanese:   { iso1: "ja", iso2: ["jpn"],           aliases: ["japanese", "日本語"] },
    korean:     { iso1: "ko", iso2: ["kor"],           aliases: ["korean", "한국어"] },
    hindi:      { iso1: "hi", iso2: ["hin"],           aliases: ["hindi", "हिन्दी"] },
    arabic:     { iso1: "ar", iso2: ["ara"],           aliases: ["arabic", "العربية"] },
    chinese:    { iso1: "zh", iso2: ["zho", "chi"],    aliases: ["chinese", "中文"] },
    dutch:      { iso1: "nl", iso2: ["nld", "dut"],    aliases: ["dutch", "nederlands"] },
    polish:     { iso1: "pl", iso2: ["pol"],           aliases: ["polish", "polski"] },
    turkish:    { iso1: "tr", iso2: ["tur"],           aliases: ["turkish", "türkçe"] },
    swedish:    { iso1: "sv", iso2: ["swe"],           aliases: ["swedish", "svenska"] },
    czech:      { iso1: "cs", iso2: ["ces", "cze"],    aliases: ["czech", "čeština"] },
    romanian:   { iso1: "ro", iso2: ["ron", "rum"],    aliases: ["romanian", "română"] },
    greek:      { iso1: "el", iso2: ["ell", "gre"],    aliases: ["greek", "ελληνικά"] },
    thai:       { iso1: "th", iso2: ["tha"],           aliases: ["thai", "ไทย"] },
    vietnamese: { iso1: "vi", iso2: ["vie"],           aliases: ["vietnamese", "tiếng việt"] },
    indonesian: { iso1: "id", iso2: ["ind"],           aliases: ["indonesian", "bahasa indonesia"] },
    ukrainian:  { iso1: "uk", iso2: ["ukr"],           aliases: ["ukrainian", "українська"] },
    norwegian:  { iso1: "no", iso2: ["nor"],           aliases: ["norwegian", "norsk"] },
    danish:     { iso1: "da", iso2: ["dan"],           aliases: ["danish", "dansk"] },
    finnish:    { iso1: "fi", iso2: ["fin"],           aliases: ["finnish", "suomi"] },
    hebrew:     { iso1: "he", iso2: ["heb"],           aliases: ["hebrew", "עברית"] },
    malay:      { iso1: "ms", iso2: ["msa", "may"],    aliases: ["malay", "bahasa melayu"] },
    hungarian:  { iso1: "hu", iso2: ["hun"],           aliases: ["hungarian", "magyar"] },
    bulgarian:  { iso1: "bg", iso2: ["bul"],           aliases: ["bulgarian", "български"] },
    croatian:   { iso1: "hr", iso2: ["hrv"],           aliases: ["croatian", "hrvatski"] },
    serbian:    { iso1: "sr", iso2: ["srp"],           aliases: ["serbian", "srpski"] },
    slovak:     { iso1: "sk", iso2: ["slk", "slo"],    aliases: ["slovak", "slovenčina"] },
};

/**
 * Check if a subtitle matches a preferred language (e.g. "english", "spanish").
 * Matches against ISO 639-1 ("en"), ISO 639-2 ("eng"), and display names.
 */
export function isSubtitleLanguage(sub: AddonSubtitle, preferredLang: string): boolean {
    const entry = LANG_MATCH[preferredLang.toLowerCase()];
    if (!entry) return false;

    const lang = sub.lang.trim().toLowerCase();
    const base = lang.split("-")[0]!;

    if (base === entry.iso1 || entry.iso2.includes(base)) return true;

    const name = (sub.name ?? "").trim().toLowerCase();
    return entry.aliases.some((a) => lang.includes(a) || name.includes(a));
}

/** Font stack tail so musical symbols / emoji in cues render instead of “tofu” (especially with mono/serif faces). */
export const SUBTITLE_SYMBOL_FONT_FALLBACK =
    '"Segoe UI Symbol","Segoe UI Emoji","Apple Color Emoji","Noto Sans Symbols 2","Noto Music","Noto Color Emoji",emoji,sans-serif';

/**
 * Decode subtitle file bytes: BOM (UTF-8 / UTF-16), UTF-8 (non-fatal), then repair common
 * “UTF-8 misread as Latin-1” mojibake (e.g. â™ª → ♪).
 */
export function decodeSubtitleFileBytes(buf: ArrayBuffer): string {
    if (buf.byteLength === 0) return "";

    const u8 = new Uint8Array(buf);

    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(buf.slice(3));
    }
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(buf.slice(2));
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(buf.slice(2));
    }

    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return repairUtf8MojibakeIfNeeded(utf8);
}

/**
 * If a file was UTF-8 but interpreted as ISO-8859-1/Windows-1252, re-encode code units as bytes and decode as UTF-8.
 */
export function repairUtf8MojibakeIfNeeded(text: string): string {
    if (text.length < 3) return text;
    // Quick skip when string is already clean Unicode (no high-bit Latin mojibake clusters)
    if (!/[ÂÃâ€¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿]/.test(text)) return text;

    try {
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            if (c > 255) return text;
            bytes[i] = c;
        }
        const candidate = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        const candRepl = (candidate.match(/\uFFFD/g) ?? []).length;
        const origRepl = (text.match(/\uFFFD/g) ?? []).length;
        const hasMusic = /[\u2669\u266A\u266B\u266C\u266D\u266E\u266F\u{1F3B5}\u{1F3B6}]/u.test(candidate);
        const hadGarbledMusic = /â™[ª«]/.test(text);
        if (candRepl < origRepl || (hasMusic && hadGarbledMusic) || (candRepl === 0 && /[♪♫♬…–—]/.test(candidate) && /â|Ã|Â/.test(text))) {
            return candidate;
        }
    } catch {
        /* keep original */
    }
    return text;
}

const SUBTITLE_NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lrm: "\u200E",
    rlm: "\u200F",
    hellip: "\u2026",
    middot: "\u00B7",
    ndash: "\u2013",
    mdash: "\u2014",
    lsquo: "\u2018",
    rsquo: "\u2019",
    sbquo: "\u201A",
    ldquo: "\u201C",
    rdquo: "\u201D",
    bdquo: "\u201E",
    bull: "\u2022",
    copy: "\u00A9",
    reg: "\u00AE",
    trade: "\u2122",
    euro: "\u20AC",
    pound: "\u00A3",
    yen: "\u00A5",
    cent: "\u00A2",
    deg: "\u00B0",
    times: "\u00D7",
    divide: "\u00F7",
    // Musical symbols (named entities used in some XML/HTML exports)
    sharp: "\u266F",
    flat: "\u266D",
    natural: "\u266E",
    // Common lyrics markers (non-standard but seen in community subs)
    music: "\u266A",
    mus: "\u266A",
};

/**
 * Decode numeric and a safe whitelist of named HTML/XML entities (subtitle text is untrusted).
 * Runs in a loop so patterns like {@code &amp;#9834;} resolve correctly.
 */
export function decodeSubtitleEntities(text: string): string {
    if (!text.includes("&")) return text;

    let s = text;
    const maxPasses = 14;
    for (let p = 0; p < maxPasses && s.includes("&"); p++) {
        const next = s
            .replace(/&#x([0-9a-fA-F]{1,6});?/gi, (full, h: string) => {
                const cp = parseInt(h, 16);
                return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
            })
            .replace(/&#(\d{1,7});?/g, (full, n: string) => {
                const cp = Number(n);
                return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
            })
            .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (full, name: string) => SUBTITLE_NAMED_ENTITIES[name.toLowerCase()] ?? full);
        if (next === s) break;
        s = next;
    }

    return s;
}

/**
 * Strip SSA/ASS and WebVTT markup from one cue line, preserving visible text and line breaks.
 */
export function stripSubtitleCueMarkup(raw: string): string {
    let s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // ASS hard line breaks
    s = s.replace(/\\N/gi, "\n").replace(/\\n/g, "\n");

    // SSA/ASS override blocks
    s = s.replace(/\{\\[^}]+\}/g, "");
    s = s.replace(/\{[^}]*\\[^}]+\}/g, "");

    // WebVTT voice / class / language spans (remove tags only)
    s = s.replace(/<\/?v\.[^>\n]*>/gi, "");
    s = s.replace(/<\/?v[^>\n]*>/gi, "");
    s = s.replace(/<\/?c[^>\n]*>/gi, "");
    s = s.replace(/<\/?lang[^>\n]*>/gi, "");

    // WebVTT inline timestamp (must remove before generic tag pass)
    s = s.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "");

    // Line breaks from HTML/WebVTT
    s = s.replace(/<br\s*\/?>/gi, "\n");

    // Ruby: drop readings, keep base
    s = s.replace(/<rt[^>\n]*>[\s\S]*?<\/rt>/gi, "");
    s = s.replace(/<rp[^>\n]*>[\s\S]*?<\/rp>/gi, "");
    s = s.replace(/<\/?ruby[^>\n]*>/gi, "");

    // Basic formatting tags (strip, keep text)
    s = s.replace(/<\/?(b|i|u|strong|em)(\s[^>\n]*)?>/gi, "");

    // Remaining angle-bracket markup (font, span, etc.)
    s = s.replace(/<\/?[^>\n]+>/g, "");
    s = s.replace(/<[^>\n]*$/g, "");

    return s.trim();
}

/**
 * Full cue text cleanup: strip markup → decode entities → strip again (handles entity-encoded tags).
 */
export function normalizeSubtitleCueText(raw: string): string {
    let s = stripSubtitleCueMarkup(raw);
    s = decodeSubtitleEntities(s);
    s = stripSubtitleCueMarkup(s);
    return s;
}
