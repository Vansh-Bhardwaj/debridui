"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProgressKey } from "@/hooks/use-progress";

export interface IntroSegment {
    start_ms: number;
    end_ms: number;
    start_sec: number;
    end_sec: number;
    confidence: number;
    submission_count: number;
}

export interface IntroSegments {
    imdb_id: string;
    season: number;
    episode: number;
    intro: IntroSegment | null;
    recap: IntroSegment | null;
    outro: IntroSegment | null;
}

async function fetchIntroSegments(imdbId: string, season: number, episode: number): Promise<IntroSegments | null> {
    // Proxy through /api/introdb to bypass CORS (IntroDB only allows its own origin)
    const url = `/api/introdb?imdb_id=${imdbId}&season=${season}&episode=${episode}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`IntroDB: ${res.status}`);
    return res.json() as Promise<IntroSegments>;
}

/**
 * Fetches intro/recap/outro segment timestamps from IntroDB for a TV show episode.
 * Returns null if no data is available or the key is not a show episode.
 */
export function useIntroSegments(progressKey: ProgressKey | null | undefined) {
    const isEpisode =
        progressKey?.type === "show" &&
        progressKey.season !== undefined &&
        progressKey.episode !== undefined;

    return useQuery({
        queryKey: [
            "intro-segments",
            progressKey?.imdbId,
            progressKey?.season,
            progressKey?.episode,
        ],
        queryFn: () =>
            fetchIntroSegments(
                progressKey!.imdbId,
                progressKey!.season!,
                progressKey!.episode!
            ),
        enabled: !!isEpisode,
        staleTime: 24 * 60 * 60 * 1000, // 24 hours — timestamps rarely change
        gcTime: 24 * 60 * 60 * 1000,
        retry: 1,
        throwOnError: false,
    });
}
