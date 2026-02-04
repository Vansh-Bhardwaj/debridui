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
    const lang = sub.lang.trim().toLowerCase();
    if (lang === "en" || lang === "eng" || lang.startsWith("en-")) return true;
    const name = (sub.name ?? "").trim().toLowerCase();
    return name.includes("english");
}
