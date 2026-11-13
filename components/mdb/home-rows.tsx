"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "reicon-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { useSettingsStore } from "@/lib/stores/settings";
import { traktClient, type TraktMedia } from "@/lib/trakt";
import { useDevice } from "@/components/device/device-provider";
import { MediaSection } from "./media-section";
import { MediaCard } from "./media-card";
import { WatchButton } from "@/components/common/watch-button";
import { Button } from "@/components/ui/button";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { homeJson, historyMetadata, recommendations, showEpisodes, tmdbItems } from "./home-data";
import { selectUpNext, rankGenres, recentTitles, recentlyAired, type HomeHistory } from "./home-selection";
import { cinemetaToTraktMedia, fetchCinemetaMeta } from "@/lib/cinemeta";
import Link from "next/link";
import Image from "next/image";
import { getPosterUrl } from "@/lib/utils/media";

const cache = { staleTime: 30 * 60000, gcTime: 24 * 3600000, refetchOnWindowFocus: false };

export function LazyHomeRow({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
        }, { rootMargin: "600px 0px" });
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    return <div ref={ref} className={visible ? undefined : "min-h-24"}>{visible && children}</div>;
}

function useHomeHistory() {
    const { activeProfile } = useProfile();
    return useQuery({ queryKey: ["home-history", activeProfile.id], queryFn: async ({ signal }) => (await homeJson<{ history: HomeHistory[] }>("/api/history?limit=100", signal)).history, ...cache, staleTime: 30000 });
}

const hiddenKey = (imdbId: string, e: { season: number; episode: number }) => `${imdbId}:show:${e.season}:${e.episode}`;

function EpisodeRow({ kind }: { kind: "next" | "new" }) {
    const { activeProfile } = useProfile();
    const { isTV } = useDevice();
    const queryClient = useQueryClient();
    const history = useHomeHistory();
    const progressResponse = useQuery({ queryKey: ["home-progress", activeProfile.id], queryFn: ({ signal }) => homeJson<{ progress: HomeHistory[]; hidden?: string[] }>("/api/progress", signal), ...cache, staleTime: 30000 });
    const progress = { data: progressResponse.data?.progress };
    const [removed, setRemoved] = useState<Set<string>>(new Set());
    const hidden = new Set([...(progressResponse.data?.hidden ?? []), ...removed]);
    // Rewatches and dropped shows shouldn't keep resurfacing: hide this suggestion for the profile, on every device.
    const remove = (imdbId: string, episode: { season: number; episode: number }) => {
        setRemoved((prev) => new Set([...prev, hiddenKey(imdbId, episode)]));
        const params = new URLSearchParams({ imdbId, type: "show", season: String(episode.season), episode: String(episode.episode), mode: "hide" });
        fetch(`/api/progress?${params}`, { method: "DELETE" })
            .then(() => queryClient.invalidateQueries({ queryKey: ["home-progress", activeProfile.id] }))
            .catch(() => toast.error("Couldn't remove it. Try again."));
    };
    const { data } = useQuery({
        queryKey: ["home-episodes", activeProfile.id, kind, history.data, progress.data], ...cache,
        enabled: !!history.data && !!progress.data,
        queryFn: async () => {
            const shows = recentTitles([...(history.data ?? []), ...(progress.data ?? [])].filter((h) => h.type === "show"));
            const rows = await Promise.all(shows.map(async (h) => {
                try {
                    const [episodes, meta] = await Promise.all([showEpisodes(h.imdbId), fetchCinemetaMeta(h.imdbId, "show")]);
                    const episode = kind === "new" ? recentlyAired(episodes)[0] : selectUpNext(episodes, h);
                    if (!episode || !meta) return null;
                    return { media: cinemetaToTraktMedia(meta, "show"), episode, imdbId: h.imdbId };
                } catch { return null; }
            }));
            return rows.filter((r) => r !== null);
        },
    });
    const visible = data?.filter(({ imdbId, episode }) => !hidden.has(hiddenKey(imdbId, episode)));
    if (!visible?.length) return null;
    return <section data-tv-section className="space-y-4">
        <h2 className={isTV ? "text-tv-title font-light" : "text-xl font-light"}>{kind === "next" ? "Up Next" : "New Episodes"}</h2>
        <ScrollCarousel><div className="flex gap-4 py-2">{visible.map(({ media, episode, imdbId }) => <div key={imdbId} className="group relative w-44 shrink-0 space-y-2">
            <MediaCard media={media} type="show" />
            <button type="button" data-tv-focusable onClick={() => remove(imdbId, episode)} aria-label={`Remove ${media.title} from ${kind === "next" ? "Up Next" : "New Episodes"}`}
                className="absolute right-1 top-1 z-20 flex size-8 items-center justify-center bg-black/70 text-white/80 transition-[opacity,background-color] duration-200 hover:bg-destructive hover:text-white focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                <X className="size-4" />
            </button>
            <WatchButton imdbId={imdbId} mediaType="show" title={media.title} tvParams={episode}><Button data-tv-focusable className="w-full min-h-phone-touch" variant="outline">Play S{episode.season}E{episode.episode}</Button></WatchButton>
            {episode.title && <p className="text-xs text-muted-foreground truncate">{episode.title}</p>}
        </div>)}</div></ScrollCarousel>
    </section>;
}

function BecauseRow({ media, type }: { media: TraktMedia; type: "movie" | "show" }) {
    const { activeProfile } = useProfile();
    const key = useSettingsStore((s) => s.get("tmdbApiKey"));
    const { data } = useQuery({ queryKey: ["home-because", activeProfile.id, type, media.ids?.imdb, key], queryFn: () => recommendations(media, type, key), enabled: !!key, ...cache });
    return data?.length ? <MediaSection title={`Because You Watched ${media.title}`} items={data} rows={1} /> : null;
}

function BecauseRows() {
    const { activeProfile } = useProfile();
    const history = useHomeHistory();
    const { data } = useQuery({ queryKey: ["home-finished", activeProfile.id, history.data], queryFn: () => historyMetadata(recentTitles(history.data ?? [], true, 2)), enabled: !!history.data, ...cache });
    return data?.map(({ history: h, media }) => media && <LazyHomeRow key={`${h.type}:${h.imdbId}`}><BecauseRow media={media} type={h.type} /></LazyHomeRow>);
}

function TopTen() {
    const { activeProfile } = useProfile();
    const { isTV } = useDevice();
    const key = useSettingsStore((s) => s.get("tmdbApiKey"));
    const { data } = useQuery({ queryKey: ["home-top-ten", activeProfile.id, new Date().toISOString().slice(0, 10), key], queryFn: async () => key ? tmdbItems("trending/all/day", key) : traktClient.getTrendingMovies(10), ...cache });
    if (!data?.length) return null;
    return <section data-tv-section className="space-y-4">
        <h2 className={isTV ? "text-tv-title font-light" : "text-xl font-light"}>Top 10 Today</h2>
        <ScrollCarousel><div className="flex gap-6 py-2">{data.slice(0, 10).map((item, index) => {
            const media = item.movie ?? item.show;
            if (!media) return null;
            const type = item.movie ? "movies" : "shows";
            const poster = getPosterUrl(media.images);
            return <Link key={`${type}:${media.ids?.tmdb || media.ids?.trakt}`} href={`/${type}/${media.ids?.slug || media.ids?.imdb}`} data-tv-focusable className="flex w-52 shrink-0 gap-2 focus-visible:outline-2 focus-visible:outline-primary">
                <span className="text-7xl font-bold tabular-nums text-primary self-end" aria-hidden>{index + 1}</span>
                <div className="flex-1 min-w-0 space-y-2"><div className="relative aspect-2/3 bg-muted/30">{poster && <Image src={poster} alt="" fill sizes="150px" unoptimized className="object-cover" />}</div><p className="text-sm truncate">{media.title}</p></div>
            </Link>;
        })}</div></ScrollCarousel>
    </section>;
}

function GenreRow({ genre }: { genre: string }) {
    const { activeProfile } = useProfile();
    const { data } = useQuery({ queryKey: ["home-genre", activeProfile.id, genre], queryFn: async () => {
        const catalog = await homeJson<{ metas: Parameters<typeof cinemetaToTraktMedia>[0][] }>(`https://v3-cinemeta.strem.io/catalog/movie/top/genre=${encodeURIComponent(genre.charAt(0).toUpperCase() + genre.slice(1))}.json`);
        return catalog.metas.slice(0, 20).map((m) => ({ movie: cinemetaToTraktMedia(m, "movie") }));
    }, ...cache });
    return data?.length ? <MediaSection title={genre.charAt(0).toUpperCase() + genre.slice(1)} items={data} rows={1} /> : null;
}

function GenreRows() {
    const { activeProfile } = useProfile();
    const history = useHomeHistory();
    const { data } = useQuery({ queryKey: ["home-genres", activeProfile.id, history.data], queryFn: async () => rankGenres((await historyMetadata(recentTitles(history.data ?? []))).flatMap((r) => r.media ? [r.media] : [])), enabled: !!history.data, ...cache });
    return data?.map((genre) => <LazyHomeRow key={genre}><GenreRow genre={genre} /></LazyHomeRow>);
}

export function ProfileGenreRows() {
    return <LazyHomeRow><GenreRows /></LazyHomeRow>;
}

export function ProfileHomeRows() {
    return <><LazyHomeRow><EpisodeRow kind="next" /></LazyHomeRow><LazyHomeRow><EpisodeRow kind="new" /></LazyHomeRow><LazyHomeRow><BecauseRows /></LazyHomeRow><LazyHomeRow><TopTen /></LazyHomeRow></>;
}
