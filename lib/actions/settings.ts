"use server";

import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { serverSettingsSchema } from "@/lib/schemas";
import { TraktClient } from "@/lib/trakt";
import { getAppUrl, getEnv } from "@/lib/env";
import { fetchViaProxy } from "@/lib/proxy-fetch";
import type { ServerSettings } from "@/lib/types";

export async function getUserSettings(): Promise<ServerSettings | null> {
    const { data: session } = await auth.getSession();
    if (!session) return null;

    try {
        const result = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);
        return (result[0]?.settings as ServerSettings) ?? null;
    } catch (error) {
        console.error("Failed to fetch user settings:", error);
        return null;
    }
}

export async function saveUserSettings(input: Partial<ServerSettings>) {
    const { data: session } = await auth.getSession();
    if (!session) redirect("/login");

    const updates = serverSettingsSchema.partial().parse(input);

    try {
        const jsonValue = JSON.stringify(updates);
        await db
            .insert(userSettings)
            .values({ userId: session.user.id, settings: updates })
            .onConflictDoUpdate({
                target: userSettings.userId,
                set: {
                    settings: sql`COALESCE(${userSettings.settings}, '{}'::jsonb) || ${jsonValue}::jsonb`,
                },
            });

        return { success: true };
    } catch (error) {
        console.error("Failed to save user settings:", error);
        throw new Error("Failed to save user settings");
    }
}

export async function disconnectTrakt() {
    const { data: session } = await auth.getSession();
    if (!session) redirect("/login");

    try {
        const clearTokens = JSON.stringify({
            trakt_access_token: null,
            trakt_refresh_token: null,
            trakt_expires_at: null,
        });
        await db
            .insert(userSettings)
            .values({ userId: session.user.id, settings: {} })
            .onConflictDoUpdate({
                target: userSettings.userId,
                set: {
                    settings: sql`COALESCE(${userSettings.settings}, '{}'::jsonb) || ${clearTokens}::jsonb`,
                },
            });

        return { success: true };
    } catch (error) {
        console.error("Failed to disconnect Trakt:", error);
        throw new Error("Failed to disconnect Trakt");
    }
}

// ── Trakt Token Refresh ────────────────────────────────────────────────

/**
 * Refreshes the Trakt access token using the stored refresh token.
 * Returns the new access token on success, or null if refresh fails.
 */
export async function refreshTraktToken(): Promise<string | null> {
    const { data: session } = await auth.getSession();
    if (!session) return null;

    try {
        const result = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        const settings = result[0]?.settings as ServerSettings | undefined;
        const refreshToken = settings?.trakt_refresh_token;
        if (!refreshToken) return null;

        const clientId = getEnv("NEXT_PUBLIC_TRAKT_CLIENT_ID");
        const clientSecret = getEnv("TRAKT_CLIENT_SECRET");
        if (!clientId || !clientSecret) return null;

        const redirectUri = `${getAppUrl()}/api/trakt/callback`;

        const tokens = await TraktClient.refreshToken(
            refreshToken, clientId, clientSecret, redirectUri, fetchViaProxy
        );

        const expiresAt = tokens.created_at + tokens.expires_in;
        const updates = {
            trakt_access_token: tokens.access_token,
            trakt_refresh_token: tokens.refresh_token,
            trakt_expires_at: expiresAt,
        };
        const jsonValue = JSON.stringify(updates);

        await db
            .insert(userSettings)
            .values({ userId: session.user.id, settings: updates })
            .onConflictDoUpdate({
                target: userSettings.userId,
                set: {
                    settings: sql`COALESCE(${userSettings.settings}, '{}'::jsonb) || ${jsonValue}::jsonb`,
                },
            });

        return tokens.access_token;
    } catch (error) {
        console.error("[trakt] Token refresh failed:", error);
        return null;
    }
}
