import type { TraktSearchResult } from "@/lib/trakt";

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for"]);

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/['']/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Pull trailing (YYYY) or "YYYY" from query for year-aware ranking */
export function parseYearHint(query: string): { text: string; year: number | null } {
    const t = query.trim();
    const paren = t.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    if (paren) {
        const y = parseInt(paren[2]!, 10);
        return { text: paren[1]!.trim(), year: Number.isFinite(y) ? y : null };
    }
    const endYear = t.match(/^(.+?)[\s,.-]+(\d{4})\s*$/);
    if (endYear) {
        const y = parseInt(endYear[2]!, 10);
        if (y >= 1870 && y <= 2100) {
            return { text: endYear[1]!.trim(), year: y };
        }
    }
    return { text: t, year: null };
}

function tokens(s: string): string[] {
    return normalize(s)
        .split(" ")
        .filter((w) => w.length > 0 && !STOP.has(w));
}

function mediaTitle(r: TraktSearchResult): string {
    return r.movie?.title ?? r.show?.title ?? "";
}

function mediaYear(r: TraktSearchResult): number {
    return r.movie?.year ?? r.show?.year ?? 0;
}

/**
 * Re-rank Trakt (+ merged) search hits so exact / near titles float to the top.
 * Trakt's `score` is kept as a tiebreaker tail.
 */
export function rankTraktSearchResults(query: string, results: TraktSearchResult[]): TraktSearchResult[] {
    const { text: qText, year: qYear } = parseYearHint(query);
    const qNorm = normalize(qText);
    const qToks = tokens(qText);
    if (!qNorm) return [...results].sort((a, b) => b.score - a.score);

    const scoreOne = (r: TraktSearchResult): number => {
        const title = mediaTitle(r);
        const tNorm = normalize(title);
        const year = mediaYear(r);
        let s = 0;

        if (tNorm === qNorm) s += 10_000;
        else if (tNorm.startsWith(qNorm + " ") || tNorm.startsWith(qNorm)) s += 6_000;
        else if (qNorm.length >= 4 && tNorm.includes(qNorm)) s += 3_500;

        if (qToks.length > 0) {
            const tToks = new Set(tokens(title));
            let hit = 0;
            for (const w of qToks) {
                if (tToks.has(w)) hit++;
                else if (tNorm.includes(w)) hit += 0.85;
            }
            s += (hit / qToks.length) * 2_500;
        }

        if (qYear != null && year === qYear) s += 2_200;
        else if (qYear != null && Math.abs(year - qYear) === 1) s += 400;

        s += Math.min(r.score, 500) * 2;
        return s;
    };

    return [...results].sort((a, b) => {
        const da = scoreOne(a) - scoreOne(b);
        if (Math.abs(da) > 0.5) return -da;
        return b.score - a.score;
    });
}

export function dedupeTraktSearchResults(results: TraktSearchResult[]): TraktSearchResult[] {
    const seen = new Set<string>();
    const out: TraktSearchResult[] = [];
    for (const r of results) {
        const m = r.movie || r.show;
        if (!m) continue;
        const type = r.movie ? "m" : "s";
        const imdb = m.ids?.imdb;
        const tmdb = m.ids?.tmdb;
        const key = imdb ? `${type}:imdb:${imdb}` : tmdb ? `${type}:tmdb:${tmdb}` : `${type}:${normalize(m.title)}:${m.year}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
    }
    return out;
}
