"use server";

import { db } from "@/lib/db";
import { profiles, profileSettings, userSettings } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getActor, UnauthorizedError } from "@/lib/auth/actor";
import { z } from "zod/mini";
import { serverSettingsSchema, profilePreferencesSchema } from "@/lib/schemas";
import { TraktClient } from "@/lib/trakt";
import { getAppUrl, getEnv } from "@/lib/env";
import { fetchViaProxy } from "@/lib/proxy-fetch";
import type { ServerSettings } from "@/lib/types";

export async function getUserSettings(): Promise<ServerSettings | null> {
    const actor = await getActor().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });
    if (!actor) return null;
    const [shared, personal] = await Promise.all([
        db.select().from(userSettings).where(eq(userSettings.userId, actor.userId)).limit(1),
        db.select({ settings: profileSettings.settings }).from(profileSettings)
            .innerJoin(profiles, eq(profiles.id, profileSettings.profileId))
            .where(and(eq(profiles.userId, actor.userId), eq(profileSettings.profileId, actor.profileId))).limit(1),
    ]);
    const account = shared[0]?.settings as ServerSettings | undefined;
    const profile = personal[0]?.settings as ServerSettings | undefined;
    return {
        tmdb_api_key: account?.tmdb_api_key ?? undefined,
        trakt_access_token: profile?.trakt_access_token ?? undefined,
        trakt_refresh_token: profile?.trakt_refresh_token ?? undefined,
        trakt_expires_at: profile?.trakt_expires_at ?? undefined,
    };
}

export async function saveUserSettings(input: Partial<ServerSettings>) {
    const { userId, profileId } = await getActor();
    const { tmdb_api_key, ...personal } = z.partial(serverSettingsSchema).parse(input);
    if (tmdb_api_key !== undefined) {
        const updates = { tmdb_api_key };
        await db.insert(userSettings).values({ userId, settings: updates }).onConflictDoUpdate({
            target: userSettings.userId,
            set: { settings: sql`${userSettings.settings} || ${JSON.stringify(updates)}::jsonb` },
        });
    }
    if (Object.keys(personal).length) {
        await db.insert(profileSettings).values({ profileId, settings: personal }).onConflictDoUpdate({
            target: profileSettings.profileId,
            set: { settings: sql`${profileSettings.settings} || ${JSON.stringify(personal)}::jsonb`, updatedAt: new Date() },
        });
    }
    return { success: true };
}

export async function getProfilePreferences() {
    const { userId, profileId } = await getActor();
    const [row] = await db.select({ settings: profileSettings.settings }).from(profileSettings)
        .innerJoin(profiles, eq(profiles.id, profileSettings.profileId))
        .where(and(eq(profiles.userId, userId), eq(profileSettings.profileId, profileId))).limit(1);
    return (row?.settings as { preferences?: Record<string, unknown> } | undefined)?.preferences ?? {};
}

export async function saveProfilePreferences(input: Record<string, unknown>) {
    const { profileId } = await getActor();
    const preferences = profilePreferencesSchema.parse(input);
    await db.insert(profileSettings).values({ profileId, settings: { preferences } }).onConflictDoUpdate({
        target: profileSettings.profileId,
        set: { settings: sql`${profileSettings.settings} || ${JSON.stringify({ preferences })}::jsonb`, updatedAt: new Date() },
    });
    return { success: true };
}

export async function disconnectTrakt() {
    const { profileId } = await getActor();
    await db.insert(profileSettings).values({ profileId, settings: {} }).onConflictDoUpdate({
        target: profileSettings.profileId,
        set: { settings: sql`${profileSettings.settings} - 'trakt_access_token' - 'trakt_refresh_token' - 'trakt_expires_at'`, updatedAt: new Date() },
    });
    return { success: true };
}

export async function refreshTraktToken(): Promise<string | null> {
    const actor = await getActor().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });
    if (!actor) return null;
    try {
        const [row] = await db.select({ settings: profileSettings.settings }).from(profileSettings)
            .innerJoin(profiles, eq(profiles.id, profileSettings.profileId))
            .where(and(eq(profiles.userId, actor.userId), eq(profileSettings.profileId, actor.profileId))).limit(1);
        const refreshToken = (row?.settings as ServerSettings | undefined)?.trakt_refresh_token;
        const clientId = getEnv("NEXT_PUBLIC_TRAKT_CLIENT_ID");
        const clientSecret = getEnv("TRAKT_CLIENT_SECRET");
        if (!refreshToken || !clientId || !clientSecret) return null;
        const tokens = await TraktClient.refreshToken(refreshToken, clientId, clientSecret, `${getAppUrl()}/api/trakt/callback`, fetchViaProxy);
        const updates = { trakt_access_token: tokens.access_token, trakt_refresh_token: tokens.refresh_token, trakt_expires_at: tokens.created_at + tokens.expires_in };
        await db.insert(profileSettings).values({ profileId: actor.profileId, settings: updates }).onConflictDoUpdate({
            target: profileSettings.profileId,
            set: { settings: sql`${profileSettings.settings} || ${JSON.stringify(updates)}::jsonb`, updatedAt: new Date() },
        });
        return tokens.access_token;
    } catch (error) {
        console.error("[trakt] Token refresh failed:", error);
        return null;
    }
}
