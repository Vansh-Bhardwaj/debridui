import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { TraktClient } from "@/lib/trakt";
import { getAppUrl } from "@/lib/env";

/**
 * GET /api/trakt/callback?code=XXX
 * Handles the OAuth redirect from Trakt. Exchanges the code for tokens,
 * stores them in user settings, and redirects to /settings.
 */
export async function GET(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.redirect(new URL("/login", getAppUrl()));
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=no_code", getAppUrl()));
    }

    const clientId = process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID;
    const clientSecret = process.env.TRAKT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error("[trakt] Missing TRAKT_CLIENT_SECRET env var");
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=config", getAppUrl()));
    }

    const redirectUri = `${getAppUrl()}/api/trakt/callback`;

    try {
        const tokens = await TraktClient.exchangeCode(code, clientId, clientSecret, redirectUri);

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

        return NextResponse.redirect(new URL("/settings?trakt=connected", getAppUrl()));
    } catch (error) {
        console.error("[trakt] Token exchange failed:", error);
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=exchange", getAppUrl()));
    }
}
