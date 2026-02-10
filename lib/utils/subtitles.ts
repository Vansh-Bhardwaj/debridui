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
