"use client";

import { type TraktMedia, type TraktEpisode, type TraktSeason } from "@/lib/trakt";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { useTraktShowSeasons, useTraktShowEpisodes } from "@/hooks/use-trakt";
import { useTMDBSeriesEpisodeGroups, useTMDBEpisodeGroupDetails } from "@/hooks/use-tmdb";
import { SeasonCard } from "./season-card";
import { EpisodeCard } from "./episode-card";
import { PeopleSection } from "./people-section";
import { MediaHeader } from "./media-header";
import { SectionDivider } from "@/components/section-divider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, memo, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { TMDBEpisodeGroupEpisode } from "@/lib/tmdb";

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

const EpisodesSection = memo(function EpisodesSection({
    selectedSeason,
    episodeCount,
    mediaId,
    media,
    label,
    preloadedEpisodes,
}: {
    selectedSeason: number;
    episodeCount?: number;
    mediaId: string;
    media: TraktMedia;
    label?: string;
    preloadedEpisodes?: TraktEpisode[];
}): React.ReactElement | null {
    const { data: episodes, isLoading } = useTraktShowEpisodes(mediaId, selectedSeason);

    const displayEpisodes = preloadedEpisodes ?? episodes;
    if (!isLoading && !preloadedEpisodes && (!displayEpisodes || displayEpisodes.length === 0)) return null;

    const seasonLabel = label ?? (selectedSeason === 0 ? "Specials" : `Season ${selectedSeason}`);
    const skeletonCount = Math.min(episodeCount || 3, 20);
    const loading = !preloadedEpisodes && isLoading;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-light text-muted-foreground" id="sources">
                    {seasonLabel}
                </h3>
                {displayEpisodes && (
                    <span className="text-xs tracking-wider uppercase text-muted-foreground">
                        {displayEpisodes.length} Episodes
                    </span>
                )}
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
                    : displayEpisodes?.map((episode) => (
                          <EpisodeCard
                              key={`${selectedSeason}-${episode.number}`}
                              episode={episode}
                              imdbId={media.ids?.imdb}
                              showTitle={media.title}
                          />
                      ))}
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

    return (
        <div className="space-y-12">
            <MediaHeader media={media} mediaId={mediaId} type="show" />

            <section id="seasons" className="space-y-6 scroll-mt-16">
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

            <section className="space-y-6">
                <SectionDivider label="Cast & Crew" />
                <PeopleSection mediaId={mediaId} type="shows" />
            </section>
        </div>
    );
});
