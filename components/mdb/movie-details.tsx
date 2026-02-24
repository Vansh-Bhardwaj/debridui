"use client";

import { type TraktMedia } from "@/lib/trakt";
import { PeopleSection } from "./people-section";
import { Sources } from "./sources";
import { MediaHeader } from "./media-header";
import { RelatedMedia } from "./related-media";
import { MovieCollection } from "./movie-collection";
import { SectionDivider } from "@/components/common/section-divider";
import { memo } from "react";

interface MovieDetailsProps {
    media: TraktMedia;
    mediaId: string;
}

export const MovieDetails = memo(function MovieDetails({ media, mediaId }: MovieDetailsProps) {
    const tmdbId = media.ids?.tmdb;

    return (
        <div className="space-y-12">
            <MediaHeader media={media} mediaId={mediaId} type="movie" />

            {media.ids?.imdb && (
                <section className="space-y-6" data-tv-section>
                    <SectionDivider label="Available Sources" />
                    <div id="sources">
                        <Sources imdbId={media.ids?.imdb} mediaType="movie" mediaTitle={media.title || "Movie"} />
                    </div>
                </section>
            )}

            <MovieCollection tmdbId={tmdbId} currentTmdbId={tmdbId} />

            <section className="space-y-6" data-tv-section>
                <SectionDivider label="Cast & Crew" />
                <PeopleSection mediaId={mediaId} type="movies" />
            </section>

            <section className="space-y-6" data-tv-section>
                <SectionDivider label="Related Movies" />
                <RelatedMedia mediaId={mediaId} type="movie" />
            </section>
        </div>
    );
});
