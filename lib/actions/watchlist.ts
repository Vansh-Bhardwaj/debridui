"use server";

import { and, desc, eq } from "drizzle-orm";
import { getActor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { profileWatchlist } from "@/lib/db/schema";
import type { TraktMedia } from "@/lib/trakt";

export async function getLocalWatchlist(expectedProfileId: string) {
    const { userId, profileId } = await getActor();
    if (profileId !== expectedProfileId) throw new Error("Profile changed. Please try again.");
    return db.select().from(profileWatchlist)
        .where(and(eq(profileWatchlist.userId, userId), eq(profileWatchlist.profileId, profileId)))
        .orderBy(desc(profileWatchlist.addedAt));
}

export async function mirrorTraktWatchlist(type: "movie" | "show", items: TraktMedia[], expectedProfileId: string) {
    const { userId, profileId } = await getActor();
    if (profileId !== expectedProfileId) throw new Error("Profile changed. Please try again.");
    if (!["movie", "show"].includes(type) || !Array.isArray(items) || items.length > 2000) throw new Error("Invalid watchlist");
    const seen = new Set<string>();
    const values = items.flatMap((media) => {
        const mediaId = media.ids?.imdb || (media.ids?.trakt ? `trakt:${media.ids.trakt}` : media.ids?.tmdb ? `tmdb:${media.ids.tmdb}` : "");
        if (!mediaId || !media.title || seen.has(mediaId) || mediaId.length > 100 || JSON.stringify(media).length > 50000) return [];
        seen.add(mediaId);
        return [{ userId, profileId, mediaId, type, media }];
    });
    // Merge only: a Trakt response must never erase titles saved locally.
    for (let offset = 0; offset < values.length; offset += 100) {
        await db.insert(profileWatchlist).values(values.slice(offset, offset + 100)).onConflictDoNothing();
    }
}

export async function setLocalWatchlist(type: "movie" | "show", media: TraktMedia, saved: boolean, expectedProfileId: string) {
    const { userId, profileId } = await getActor();
    if (profileId !== expectedProfileId) throw new Error("Profile changed. Please try again.");
    const mediaId = media.ids?.imdb || (media.ids?.trakt ? `trakt:${media.ids.trakt}` : media.ids?.tmdb ? `tmdb:${media.ids.tmdb}` : "");
    if (!["movie", "show"].includes(type) || !mediaId || mediaId.length > 100 || !media.title || JSON.stringify(media).length > 50000) {
        throw new Error("Invalid watchlist title");
    }
    if (saved) {
        await db.insert(profileWatchlist).values({ userId, profileId, mediaId, type, media })
            .onConflictDoUpdate({ target: [profileWatchlist.userId, profileWatchlist.profileId, profileWatchlist.type, profileWatchlist.mediaId], set: { media } });
    } else {
        await db.delete(profileWatchlist).where(and(eq(profileWatchlist.userId, userId), eq(profileWatchlist.profileId, profileId), eq(profileWatchlist.type, type), eq(profileWatchlist.mediaId, mediaId)));
    }
}
