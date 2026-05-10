/**
 * Curated Stremio addon catalog.
 *
 * Kept deliberately small and hand-verified. Upstream DebridUI scrapes the
 * community list; this fork keeps a trusted curated set so we never
 * recommend a dead or hostile URL.
 *
 * Each entry either ships a direct manifest URL (one-click install) or a
 * configure URL that the user copies their manifest from. Do not add
 * URLs that have not been personally verified.
 */

export type AddonCatalogCategory = "streams" | "catalogs" | "subtitles" | "utility";
export type AddonCatalogResource = "stream" | "catalog" | "meta" | "subtitles";

export interface AddonCatalogEntry {
    id: string;
    name: string;
    description: string;
    category: AddonCatalogCategory;
    resources: AddonCatalogResource[];
    /** "direct" → manifest URL is known, one-click install. */
    /** "configure" → user must configure on the addon's own site, copy the URL back. */
    installType: "direct" | "configure";
    /** Present when installType === "direct". */
    manifestUrl?: string;
    /** Present when installType === "configure". */
    configureUrl?: string;
    /** Extra context shown under the card (e.g. "requires debrid"). */
    notes?: string;
}

export const ADDON_CATALOG: readonly AddonCatalogEntry[] = [
    {
        id: "torrentio",
        name: "Torrentio",
        description: "Aggregates torrent indexers (YTS, EZTV, RARBG, 1337x, and more) with optional debrid resolution.",
        category: "streams",
        resources: ["stream"],
        installType: "direct",
        manifestUrl:
            "https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex|qualityfilter=480p,other,scr,cam/manifest.json",
        notes: "No configuration needed. Works with all supported debrid services.",
    },
    {
        id: "streaming-catalogs",
        name: "Streaming Catalogs",
        description:
            "Browsable catalogs for Netflix, Prime Video, Disney+, HBO Max, Apple TV+, Hulu, and other major services.",
        category: "catalogs",
        resources: ["catalog", "meta"],
        installType: "direct",
        manifestUrl:
            "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/bmZ4LGRucCxhbXAsYXRwLGhibSxwbXAsamhzLHplZSxjcnUscGNwLHNvbnlsaXY6OjoxNzcwMjQ2NjcwMTU5OjA6MDo%3D/manifest.json",
        notes: "Adds multiple streaming service catalogs to browse.",
    },
    {
        id: "comet",
        name: "Comet",
        description: "Fast torrent/debrid search addon with proxy streaming support and resolution filters.",
        category: "streams",
        resources: ["stream"],
        installType: "configure",
        configureUrl: "https://comet.elfhosted.com/configure",
        notes: "Choose providers + debrid on the configure page, then paste the manifest URL here.",
    },
    {
        id: "mediafusion",
        name: "MediaFusion",
        description: "Multi-language catalogs with extensive scraper and debrid support including Live TV and anime.",
        category: "streams",
        resources: ["stream", "catalog", "meta"],
        installType: "configure",
        configureUrl: "https://mediafusion.elfhosted.com/configure",
        notes: "Pick trackers, language, and debrid on the configure page.",
    },
    {
        id: "aiostreams",
        name: "AIOStreams",
        description: "All-in-one addon that aggregates multiple scrapers with advanced filtering and formatting.",
        category: "streams",
        resources: ["stream"],
        installType: "configure",
        configureUrl: "https://aiostreams.elfhosted.com/stremio/configure",
        notes: "Compose multiple scrapers + formatting rules before installing.",
    },
    {
        id: "meteor",
        name: "Meteor",
        description: "High-performance scraper with strong anime matching and multi-debrid support.",
        category: "streams",
        resources: ["stream"],
        installType: "configure",
        configureUrl: "https://meteorfortheweebs.midnightignite.me/configure",
        notes: "Especially good for anime and niche titles.",
    },
];

export const ADDON_CATALOG_CATEGORIES: Array<{
    id: AddonCatalogCategory | "all";
    label: string;
}> = [
    { id: "all", label: "All" },
    { id: "streams", label: "Streams" },
    { id: "catalogs", label: "Catalogs" },
    { id: "subtitles", label: "Subtitles" },
    { id: "utility", label: "Utility" },
];
