"use server";

import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { serverSettingsSchema } from "@/lib/schemas";
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
