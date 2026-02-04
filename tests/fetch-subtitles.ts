import { AddonClient } from "@/lib/addons/client";
import type { AddonSubtitle } from "@/lib/addons/types";

type MediaTypeArg = "movie" | "show";

function getArg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    if (i === -1) return undefined;
    return process.argv[i + 1];
}

function getArgs(name: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]!);
    }
    return out;
}

function supportsSubtitles(manifest: { resources?: Array<string | { name?: string }> }): boolean {
    return (
        manifest?.resources?.some((r) => (typeof r === "string" ? r === "subtitles" : r?.name === "subtitles")) ??
        false
    );
}

function getLanguageDisplayName(rawLang: string): string {
    const lang = rawLang.trim();
    // Stremio behavior: if it's not a valid ISO-ish code, treat it as display text.
    if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(lang)) return lang;

    const base = lang.split("-")[0]!.toLowerCase();
    // Common Stremio/community codes that aren't standard ISO language tags.
    if (base === "pob") {
        try {
            const dn = new Intl.DisplayNames(["en"], { type: "language" });
            return dn.of("pt-BR") ?? "Portuguese (Brazil)";
        } catch {
            return "Portuguese (Brazil)";
        }
    }
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

function getSubtitleLabel(sub: AddonSubtitle, addonName: string): string {
    const hasCustomName = !!sub.name && sub.name.trim().toLowerCase() !== sub.lang.trim().toLowerCase();
    const baseLabel = hasCustomName ? sub.name!.trim() : getLanguageDisplayName(sub.lang);
    return `${baseLabel} (${addonName})`;
}

function usage() {
    console.log(
        [
            "Usage:",
            "  bun tests/fetch-subtitles.ts --addon-url <url> [--addon-url <url> ...] --imdb <tt...> --type <movie|show> [--season N --episode N] [--probe-index N]",
            "",
            "Examples:",
            '  bun tests/fetch-subtitles.ts --addon-url "https://opensubtitles-v3.strem.io" --imdb tt0133093 --type movie',
            '  bun tests/fetch-subtitles.ts --addon-url "https://opensubtitles-v3.strem.io" --addon-url "https://aiostreams-addon.example" --imdb tt0944947 --type show --season 1 --episode 1',
            "",
            "Notes:",
            "- This calls Stremio addon endpoints: /manifest.json and /subtitles/{movie|series}/...",
            "- In the UI we still proxy subtitle URLs for browser CORS; this script prints raw URLs so we can inspect what addons return.",
        ].join("\n")
    );
}

async function probeSubtitleUrl(url: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(url, {
            headers: { range: "bytes=0-1023" },
            signal: controller.signal,
        });

        const contentType = res.headers.get("content-type") ?? "unknown";
        const text = await res.text();
        const snippet = text.replace(/\s+/g, " ").slice(0, 240);

        console.log("Probe:");
        console.log(`  status: ${res.status}`);
        console.log(`  content-type: ${contentType}`);
        console.log(`  first-chars: ${JSON.stringify(snippet)}${text.length > 240 ? "…" : ""}`);
    } catch (e) {
        console.log("Probe failed:", e instanceof Error ? e.message : String(e));
    } finally {
        clearTimeout(timeoutId);
    }
}

async function main() {
    const addonUrls = getArgs("--addon-url");
    const imdbId = getArg("--imdb");
    const type = getArg("--type") as MediaTypeArg | undefined;
    const seasonRaw = getArg("--season");
    const episodeRaw = getArg("--episode");
    const probeIndexRaw = getArg("--probe-index");

    if (!addonUrls.length || !imdbId || !type || (type !== "movie" && type !== "show")) {
        usage();
        process.exitCode = 1;
        return;
    }

    const tvParams =
        type === "show"
            ? {
                  season: Number(seasonRaw ?? ""),
                  episode: Number(episodeRaw ?? ""),
              }
            : undefined;

    if (type === "show" && (!tvParams || !Number.isFinite(tvParams.season) || !Number.isFinite(tvParams.episode))) {
        console.error("For --type show, you must provide --season and --episode.");
        process.exitCode = 1;
        return;
    }

    const merged = new Map<string, { addonName: string; sub: AddonSubtitle }>();

    for (const url of addonUrls) {
        const client = new AddonClient({ url });
        const manifest = await client.fetchManifest();
        if (!supportsSubtitles(manifest)) {
            console.log(`- ${manifest.name}: no subtitles resource (skipping)`);
            continue;
        }

        const res = await client.fetchSubtitles(imdbId, type, tvParams);
        const subs = res.subtitles ?? [];
        console.log(`- ${manifest.name}: ${subs.length} subtitle(s)`);

        for (const sub of subs) {
            if (!sub?.url || !sub?.lang) continue;
            const key = `${sub.lang}:${sub.url}`;
            if (!merged.has(key)) merged.set(key, { addonName: manifest.name, sub });
        }
    }

    const out = Array.from(merged.values()).map(({ addonName, sub }) => ({
        lang: sub.lang,
        label: getSubtitleLabel(sub, addonName),
        url: sub.url,
    }));

    out.sort((a, b) => a.label.localeCompare(b.label));

    console.log("");
    console.log(`Merged unique subtitles: ${out.length}`);
    for (let i = 0; i < out.length; i++) {
        const s = out[i]!;
        console.log(`[${i}] ${s.label}`);
        console.log(`    lang: ${s.lang}`);
        console.log(`    url:  ${s.url}`);
    }

    if (probeIndexRaw != null) {
        const idx = Number(probeIndexRaw);
        if (!Number.isFinite(idx) || idx < 0 || idx >= out.length) {
            console.error(`\nInvalid --probe-index ${probeIndexRaw}. Must be 0..${Math.max(0, out.length - 1)}.`);
            process.exitCode = 1;
            return;
        }

        console.log("");
        console.log(`Probing subtitle [${idx}] ${out[idx]!.label}`);
        await probeSubtitleUrl(out[idx]!.url);
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});

