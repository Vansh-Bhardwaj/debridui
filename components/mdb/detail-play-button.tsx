"use client";

import { useContinueWatching } from "@/hooks/use-progress";
import { useNextEpisode } from "@/hooks/use-next-episode";
import { WatchButton } from "@/components/common/watch-button";
import { Button } from "@/components/ui/button";
import { Play } from "reicon-react";
import type { TraktMedia } from "@/lib/trakt";

export function DetailPlayButton({ media, type }: { media: TraktMedia; type: "movie" | "show" }) {
    const { progress: data } = useContinueWatching();
    const progress = data?.filter((p) => p.imdbId === media.ids?.imdb && p.type === type).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const completed = !!progress && progress.durationSeconds > 0 && progress.progressSeconds / progress.durationSeconds >= 0.9;
    const next = useNextEpisode(media.ids?.imdb, completed ? type : undefined, progress?.season, progress?.episode);
    const tvParams = type === "show" ? completed ? next ?? { season: progress?.season ?? 1, episode: progress?.episode ?? 1 } : { season: progress?.season ?? 1, episode: progress?.episode ?? 1 } : undefined;
    const resume = progress && progress.progressSeconds > 0 && !completed;
    const label = resume ? `Resume${tvParams ? ` S${tvParams.season}E${tvParams.episode}` : ""} · ${Math.max(1, Math.ceil((progress.durationSeconds - progress.progressSeconds) / 60))}m left` : `Play${tvParams ? ` S${tvParams.season}E${tvParams.episode}` : ""}`;
    if (!media.ids?.imdb) return null;
    return <WatchButton imdbId={media.ids.imdb} mediaType={type} title={media.title} tvParams={tvParams}><Button data-tv-focusable size="lg" className="gap-2 min-h-phone-touch"><Play weight="Filled" className="size-4" />{label}</Button></WatchButton>;
}
