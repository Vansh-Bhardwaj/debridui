"use client";

import { type TraktMedia, type TraktEpisode, type TraktSeason, type TraktShowWatchedProgress } from "@/lib/trakt";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { useTraktShowSeasons, useTraktShowEpisodes, useTraktCalendarShows, useTraktShowProgress, useMarkEpisodeWatched, useUnmarkEpisodeWatched } from "@/hooks/use-trakt";
import { useTMDBSeriesEpisodeGroups, useTMDBEpisodeGroupDetails } from "@/hooks/use-tmdb";
import { SeasonCard } from "./season-card";
import { EpisodeCard } from "./episode-card";
import { PeopleSection } from "./people-section";
import { MediaHeader } from "./media-header";
import { RelatedMedia } from "./related-media";
import { SectionDivider } from "@/components/common/section-divider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, memo, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { TMDBEpisodeGroupEpisode } from "@/lib/tmdb";
import { CalendarDays, Tv, Eye, EyeOff, Loader2, Globe, Radio } from "lucide-react";
import { traktClient } from "@/lib/trakt";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTVMazeShow } from "@/hooks/use-tvmaze";

function tmdbEpisodeToTrakt(ep: TMDBEpisodeGroupEpisode): TraktEpisode {
    return {
        season: ep.season_number,
        number: ep.episode_number,
        title: ep.name,
        ids: { trakt: ep.id, slug: "", tmdb: ep.id },
        overview: ep.overview,
        first_aired: ep.air_date,
        runtime: ep.runtime ?? undefined,
        rating: ep.vote_average,
        votes: ep.vote_count,
    };
}

interface ShowDetailsProps {
    media: TraktMedia;
    mediaId: string;
}

/** Shows the next upcoming episode and show status */
const NextEpisodeBanner = memo(function NextEpisodeBanner({ media }: { media: TraktMedia }) {
    const hasAuth = !!traktClient.getAccessToken();
    const { data: calendar } = useTraktCalendarShows(30);
    const traktId = media.ids?.trakt;

    const nextEpisode = useMemo(() => {
        if (!calendar || !traktId) return null;
        return calendar
            .filter(
                (item) =>
                    item.show?.ids?.trakt === traktId &&
                    item.first_aired &&
                    new Date(item.first_aired).getTime() > new Date().getTime()
            )
            .sort(
                (a, b) =>
                    new Date(a.first_aired!).getTime() - new Date(b.first_aired!).getTime()
            )[0] ?? null;
    }, [calendar, traktId]);

    const lastAired = useMemo(() => {
        if (!calendar || !traktId) return null;
        return calendar
            .filter(
                (item) =>
                    item.show?.ids?.trakt === traktId &&
                    item.first_aired &&
                    new Date(item.first_aired).getTime() <= new Date().getTime()
            )
            .sort(
                (a, b) =>
                    new Date(b.first_aired!).getTime() - new Date(a.first_aired!).getTime()
            )[0] ?? null;
    }, [calendar, traktId]);

    const status = media.status;
    const showStatus = status
        ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : null;

    // Nothing to show if no status and no calendar data
    if (!showStatus && !nextEpisode && !lastAired) return null;
    if (!hasAuth && !showStatus) return null;

    const formatEpDate = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        const diff = d.getTime() - now.getTime();
        const days = Math.ceil(diff / 86400000);
        if (days === 0) return "Today";
        if (days === 1) return "Tomorrow";
        if (days > 1 && days <= 7) return `in ${days} days`;
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    return (
        <div className="flex flex-wrap items-center gap-3 text-sm">
            {/* Show status pill */}
            {showStatus && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Tv className="size-3" />
                    {showStatus}
                    {media.aired_episodes != null && (
                        <span className="text-border">· {media.aired_episodes} episodes</span>
                    )}
                </span>
            )}

            {/* Next episode */}
            {nextEpisode?.episode && nextEpisode.first_aired && (
                <Link
                    href={`?season=${nextEpisode.episode.season}`}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs hover:bg-primary/10 transition-colors">
                    <CalendarDays className="size-3 text-primary" />
                    <span className="text-muted-foreground">
                        Next:{" "}
                        <span className="text-foreground font-medium">
                            S{nextEpisode.episode.season}E{nextEpisode.episode.number}
                        </span>
                        {" — "}
                        {formatEpDate(nextEpisode.first_aired)}
                    </span>
                </Link>
            )}

            {/* Last aired (only if no next episode) */}
            {!nextEpisode && lastAired?.episode && lastAired.first_aired && (
                <Link
                    href={`?season=${lastAired.episode.season}`}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-border/50 px-2.5 py-1 text-xs hover:bg-muted/30 transition-colors">
                    <CalendarDays className="size-3 text-muted-foreground" />
                    <span className="text-muted-foreground">
                        Last aired:{" "}
                        <span className="text-foreground">
                            S{lastAired.episode.season}E{lastAired.episode.number}
                        </span>
                        {lastAired.episode.title && <> — {lastAired.episode.title}</>}
                    </span>
                </Link>
            )}
        </div>
    );
});

const EpisodesSection = memo(function EpisodesSection({
    selectedSeason,
    episodeCount,
    mediaId,
    media,
    label,
    preloadedEpisodes,
    watchedProgress,
    showTraktId,
}: {
    selectedSeason: number;
    episodeCount?: number;
    mediaId: string;
    media: TraktMedia;
    label?: string;
    preloadedEpisodes?: TraktEpisode[];
    watchedProgress?: TraktShowWatchedProgress;
    showTraktId?: number;
}): React.ReactElement | null {
    const { data: episodes, isLoading } = useTraktShowEpisodes(mediaId, selectedSeason);
    const markWatched = useMarkEpisodeWatched();
    const unmarkWatched = useUnmarkEpisodeWatched();

    const displayEpisodes = preloadedEpisodes ?? episodes;

    // Build a set of watched episode numbers for the selected season
    const watchedSet = useMemo(() => {
        const set = new Set<number>();
        if (!watchedProgress?.seasons) return set;
        const season = watchedProgress.seasons.find((s) => s.number === selectedSeason);
        if (!season) return set;
        for (const ep of season.episodes) {
            if (ep.completed) set.add(ep.number);
        }
        return set;
    }, [watchedProgress, selectedSeason]);

    if (!isLoading && !preloadedEpisodes && (!displayEpisodes || displayEpisodes.length === 0)) return null;

    const seasonLabel = label ?? (selectedSeason === 0 ? "Specials" : `Season ${selectedSeason}`);
    const skeletonCount = Math.min(episodeCount || 3, 20);
    const loading = !preloadedEpisodes && isLoading;
    const allWatched = displayEpisodes ? watchedSet.size >= displayEpisodes.length : false;

    const handleMarkSeasonWatched = () => {
        if (!showTraktId || !displayEpisodes) return;
        const epNumbers = displayEpisodes.map((e) => e.number);
        if (allWatched) {
            unmarkWatched.mutate({ showTraktId, showId: mediaId, season: selectedSeason, episodes: epNumbers });
        } else {
            const unwatched = epNumbers.filter((n) => !watchedSet.has(n));
            markWatched.mutate({ showTraktId, showId: mediaId, season: selectedSeason, episodes: unwatched });
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-light text-muted-foreground" id="sources">
                    {seasonLabel}
                </h3>
                <div className="flex items-center gap-3">
                    {showTraktId && displayEpisodes && displayEpisodes.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleMarkSeasonWatched}
                            disabled={markWatched.isPending || unmarkWatched.isPending}
                            className="h-7 text-xs gap-1.5 text-muted-foreground">
                            {markWatched.isPending || unmarkWatched.isPending ? (
                                <Loader2 className="size-3 animate-spin" />
                            ) : allWatched ? (
                                <EyeOff className="size-3" />
                            ) : (
                                <Eye className="size-3" />
                            )}
                            {allWatched ? "Unmark All" : "Mark All Watched"}
                        </Button>
                    )}
                    <span className="text-xs tracking-wider uppercase text-muted-foreground">
                        {watchedSet.size > 0 && (
                            <span className="text-primary/80 normal-case">{watchedSet.size}/{displayEpisodes?.length ?? "?"} watched <span className="text-border mx-1">·</span></span>
                        )}
                        {displayEpisodes ? `${displayEpisodes.length} Episodes` : null}
                    </span>
                </div>
            </div>
            <div className="flex flex-col gap-3">
                {loading
                    ? Array.from({ length: skeletonCount }).map((_, i) => (
                          <div key={i} className="rounded-sm border border-border/50 overflow-hidden">
                              <div className="flex flex-row items-start">
                                  <Skeleton className="w-36 sm:w-56 md:w-60 shrink-0 aspect-[5/3] sm:aspect-video rounded-none" />
                                  <div className="flex-1 px-2.5 py-1.5 sm:p-3 md:p-4 space-y-1.5 sm:space-y-2">
                                      <Skeleton className="h-4 sm:h-5 w-3/4" />
                                      <Skeleton className="h-3 w-1/3" />
                                      <Skeleton className="h-3 w-full hidden sm:block" />
                                  </div>
                              </div>
                          </div>
                      ))
                    : displayEpisodes?.map((episode) => {
                          const isWatched = watchedSet.has(episode.number);
                          // "New" = aired in last 7 days and not watched
                          const isNew = !isWatched && !!episode.first_aired &&
                              (new Date().getTime() - new Date(episode.first_aired).getTime()) < 7 * 86400000 &&
                              new Date(episode.first_aired).getTime() <= new Date().getTime();
                          return (
                              <EpisodeCard
                                  key={`${selectedSeason}-${episode.number}`}
                                  episode={episode}
                                  imdbId={media.ids?.imdb}
                                  showTitle={media.title}
                                  isWatched={isWatched}
                                  isNew={isNew}
                                  onToggleWatched={showTraktId ? () => {
                                      if (isWatched) {
                                          unmarkWatched.mutate({ showTraktId, showId: mediaId, season: selectedSeason, episodes: [episode.number] });
                                      } else {
                                          markWatched.mutate({ showTraktId, showId: mediaId, season: selectedSeason, episodes: [episode.number] });
                                      }
                                  } : undefined}
                                  isTogglingWatched={markWatched.isPending || unmarkWatched.isPending}
                              />
                          );
                      })}
            </div>
        </div>
    );
});

export const ShowDetails = memo(function ShowDetails({ media, mediaId }: ShowDetailsProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const seasonParam = searchParams.get("season");
    const groupParam = searchParams.get("group");
    const partParam = searchParams.get("part");

    const [selectedSeason, setSelectedSeason] = useState<number>(seasonParam ? parseInt(seasonParam, 10) : 1);
    const [selectedGroup, setSelectedGroup] = useState<string>(groupParam || "");
    const [selectedGroupIndex, setSelectedGroupIndex] = useState<number>(partParam ? parseInt(partParam, 10) : 0);

    const { data: seasons, isLoading: seasonsLoading } = useTraktShowSeasons(mediaId);
    const { data: watchedProgress } = useTraktShowProgress(mediaId);

    // TMDB episode groups (only when user has TMDB key configured)
    const tmdbId = media.ids?.tmdb;
    const { data: episodeGroupsData } = useTMDBSeriesEpisodeGroups(tmdbId ?? 0);
    const { data: groupDetails, isLoading: groupDetailsLoading } = useTMDBEpisodeGroupDetails(selectedGroup);

    const handleSeasonChange = useCallback(
        (season: number) => {
            setSelectedSeason(season);
            const params = new URLSearchParams(searchParams.toString());
            params.set("season", season.toString());
            params.delete("group");
            params.delete("part");
            router.replace(`?${params.toString()}`, { scroll: false });
        },
        [searchParams, router]
    );

    const handleGroupChange = useCallback(
        (groupId: string) => {
            if (groupId === "default") {
                setSelectedGroup("");
                setSelectedGroupIndex(0);
                const params = new URLSearchParams(searchParams.toString());
                params.delete("group");
                params.delete("part");
                router.replace(`?${params.toString()}`, { scroll: false });
                return;
            }
            setSelectedGroup(groupId);
            setSelectedGroupIndex(0);
            const params = new URLSearchParams(searchParams.toString());
            params.set("group", groupId);
            params.set("part", "0");
            router.replace(`?${params.toString()}`, { scroll: false });
        },
        [searchParams, router]
    );

    const handleGroupIndexChange = useCallback(
        (index: number) => {
            setSelectedGroupIndex(index);
            const params = new URLSearchParams(searchParams.toString());
            params.set("part", index.toString());
            router.replace(`?${params.toString()}`, { scroll: false });
        },
        [searchParams, router]
    );

    // Filter groups: exclude specials (order 0), map to TraktSeason shape for SeasonCard reuse
    const filteredGroups: TraktSeason[] = useMemo(() => {
        if (!groupDetails?.groups) return [];
        return groupDetails.groups
            .filter((g) => g.order > 0)
            .map((g) => ({
                number: g.order,
                ids: { trakt: 0, slug: "", tmdb: 0 },
                title: g.name,
                episode_count: g.episodes.length,
            }));
    }, [groupDetails]);

    // Pre-map TMDB episodes to TraktEpisode shape for the selected group part
    const groupEpisodes: TraktEpisode[] = useMemo(() => {
        if (!groupDetails?.groups) return [];
        const nonSpecials = groupDetails.groups.filter((g) => g.order > 0);
        const group = nonSpecials[selectedGroupIndex];
        if (!group) return [];
        return group.episodes.map(tmdbEpisodeToTrakt);
    }, [groupDetails, selectedGroupIndex]);

    const episodeCount = seasons?.find((s) => s.number === selectedSeason)?.episode_count;
    const hasEpisodeGroups = episodeGroupsData?.results && episodeGroupsData.results.length > 0;
    const isGroupView = !!selectedGroup;

    const { data: tvmaze } = useTVMazeShow(media.ids?.imdb, media.ids?.tvdb);

    return (
        <div className="space-y-12">
            <MediaHeader media={media} mediaId={mediaId} type="show" />

            {tvmaze && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    {(tvmaze.network || tvmaze.webChannel) && (
                        <span className="inline-flex items-center gap-1.5">
                            <Radio className="size-3.5" />
                            {tvmaze.network?.name || tvmaze.webChannel?.name}
                        </span>
                    )}
                    {tvmaze.schedule && tvmaze.schedule.days.length > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="size-3.5" />
                            {tvmaze.schedule.days.join(", ")}
                            {tvmaze.schedule.time && ` at ${tvmaze.schedule.time}`}
                        </span>
                    )}
                    {tvmaze.officialSite && /^https?:\/\//i.test(tvmaze.officialSite) && (
                        <a
                            href={tvmaze.officialSite}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                        >
                            <Globe className="size-3.5" />
                            Official Site
                        </a>
                    )}
                </div>
            )}

            <NextEpisodeBanner media={media} />

            <section id="seasons" className="space-y-6 scroll-mt-16" data-tv-section>
                <SectionDivider label="Seasons & Episodes" />

                {!isGroupView && (
                    <>
                        {(seasonsLoading || (seasons && seasons.length > 0)) && (
                            <ScrollCarousel className="-mx-4 lg:mx-0">
                                <div className="flex w-max gap-3 pb-4 px-4 lg:pl-2 lg:pr-0">
                                    {seasonsLoading
                                        ? Array.from({ length: 6 }).map((_, i) => (
                                              <Skeleton
                                                  key={i}
                                                  className="w-28 sm:w-32 md:w-36 aspect-2/3 rounded-sm shrink-0"
                                              />
                                          ))
                                        : seasons?.map((season) => (
                                              <SeasonCard
                                                  key={season.number}
                                                  season={season}
                                                  isSelected={selectedSeason === season.number}
                                                  onClick={() => handleSeasonChange(season.number)}
                                                  mediaId={mediaId}
                                              />
                                          ))}
                                </div>
                            </ScrollCarousel>
                        )}

                        <EpisodesSection
                            selectedSeason={selectedSeason}
                            episodeCount={episodeCount}
                            mediaId={mediaId}
                            media={media}
                            watchedProgress={watchedProgress}
                            showTraktId={media.ids?.trakt}
                        />
                    </>
                )}

                {isGroupView && (
                    <>
                        {groupDetailsLoading ? (
                            <ScrollCarousel className="-mx-4 lg:mx-0">
                                <div className="flex w-max gap-3 pb-4 px-4 lg:pl-2 lg:pr-0">
                                    {Array.from({ length: 4 }).map((_, i) => (
                                        <Skeleton
                                            key={i}
                                            className="w-28 sm:w-32 md:w-36 aspect-2/3 rounded-sm shrink-0"
                                        />
                                    ))}
                                </div>
                            </ScrollCarousel>
                        ) : (
                            filteredGroups.length > 0 && (
                                <>
                                    <ScrollCarousel className="-mx-4 lg:mx-0">
                                        <div className="flex w-max gap-3 pb-4 px-4 lg:pl-2 lg:pr-0">
                                            {filteredGroups.map((group, idx) => (
                                                <SeasonCard
                                                    key={group.number}
                                                    season={group}
                                                    isSelected={selectedGroupIndex === idx}
                                                    onClick={() => handleGroupIndexChange(idx)}
                                                />
                                            ))}
                                        </div>
                                    </ScrollCarousel>

                                    <EpisodesSection
                                        selectedSeason={filteredGroups[selectedGroupIndex]?.number ?? 0}
                                        mediaId={mediaId}
                                        media={media}
                                        label={filteredGroups[selectedGroupIndex]?.title}
                                        preloadedEpisodes={groupEpisodes}
                                        watchedProgress={watchedProgress}
                                        showTraktId={media.ids?.trakt}
                                    />
                                </>
                            )
                        )}
                    </>
                )}

                {hasEpisodeGroups && (
                    <div className="pt-2">
                        <Select value={selectedGroup || "default"} onValueChange={handleGroupChange}>
                            <SelectTrigger className="w-full max-w-xs">
                                <SelectValue placeholder="Default order" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default order</SelectItem>
                                {episodeGroupsData.results.map((group) => (
                                    <SelectItem key={group.id} value={group.id}>
                                        {group.name}
                                        {group.network ? ` (${group.network.name})` : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </section>

            <section className="space-y-6" data-tv-section>
                <SectionDivider label="Cast & Crew" />
                <PeopleSection mediaId={mediaId} type="shows" />
            </section>

            <section className="space-y-6" data-tv-section>
                <SectionDivider label="Related Shows" />
                <RelatedMedia mediaId={mediaId} type="show" />
            </section>
        </div>
    );
});
