import { NextRequest, NextResponse } from "next/server";
import { getActor, ownsProfile, UnauthorizedError } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { profileSettings } from "@/lib/db/schema";
import { verifyProfile } from "@/lib/auth/profile-cookie";
import { sql } from "drizzle-orm";
import { TraktClient } from "@/lib/trakt";
import { getAppUrl, getEnv, getRequiredEnv } from "@/lib/env";
import { fetchViaProxy } from "@/lib/proxy-fetch";

/**
 * GET /api/trakt/callback?code=XXX
 * Handles the OAuth redirect from Trakt. Exchanges the code for tokens,
 * stores them in the originating profile settings, and redirects to /settings.
 */
export async function GET(request: NextRequest) {
    const actor = await getActor().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });
    if (!actor) {
        return NextResponse.redirect(new URL("/login", getAppUrl()));
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=no_code", getAppUrl()));
    }

    // Validate OAuth state parameter (CSRF protection)
    const state = request.nextUrl.searchParams.get("state");
    const cookies = request.headers.get("cookie") || "";
    const stateMatch = cookies.match(/(?:^|;\s*)trakt_oauth_state=([^;]+)/);
    const storedState = stateMatch?.[1];
    if (!state || !storedState || state !== storedState) {
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=state_mismatch", getAppUrl()));
    }

    const parts = state.split(".");
    const profileId = parts.length === 3
        ? await verifyProfile(parts.slice(0, 2).join("."), actor.userId, getRequiredEnv("NEON_AUTH_COOKIE_SECRET"))
        : null;
    if (!profileId || !await ownsProfile(actor.userId, profileId)) {
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=profile", getAppUrl()));
    }

    const clientId = getEnv("NEXT_PUBLIC_TRAKT_CLIENT_ID");
    const clientSecret = getEnv("TRAKT_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
        console.error("[trakt] Missing env:", {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
        });
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=config", getAppUrl()));
    }

    const redirectUri = `${getAppUrl()}/api/trakt/callback`;

    try {
        const tokens = await TraktClient.exchangeCode(code, clientId, clientSecret, redirectUri, fetchViaProxy);

        const expiresAt = tokens.created_at + tokens.expires_in;
        const updates = {
            trakt_access_token: tokens.access_token,
            trakt_refresh_token: tokens.refresh_token,
            trakt_expires_at: expiresAt,
        };
        const jsonValue = JSON.stringify(updates);

        await db
            .insert(profileSettings)
            .values({ profileId, settings: updates })
            .onConflictDoUpdate({
                target: profileSettings.profileId,
                set: {
                    updatedAt: new Date(),
                    settings: sql`COALESCE(${profileSettings.settings}, '{}'::jsonb) || ${jsonValue}::jsonb`,
                },
            });

        const response = NextResponse.redirect(new URL("/settings?trakt=connected", getAppUrl()));
        // Clear the OAuth state cookie
        response.cookies.set("trakt_oauth_state", "", { path: "/", maxAge: 0 });
        response.headers.set("Cache-Control", "no-store");
        return response;
    } catch (error) {
        console.error("[trakt] Token exchange failed:", {
            error: error instanceof Error ? error.message : error,
            redirectUri,
            appUrl: getAppUrl(),
        });
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=exchange", getAppUrl()));
    }
}
