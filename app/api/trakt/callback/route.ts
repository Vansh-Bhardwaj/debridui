import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { TraktClient } from "@/lib/trakt";
import { getAppUrl, getEnv } from "@/lib/env";

/**
 * Resolve TRAKT_CLIENT_SECRET from process.env or Cloudflare context.
 * Secrets set via `wrangler secret put` may only be available through
 * the Cloudflare context env binding, not process.env.
 */
function getTraktSecret(): string | undefined {
    const fromEnv = getEnv("TRAKT_CLIENT_SECRET");
    if (fromEnv) return fromEnv;

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getCloudflareContext } = require("@opennextjs/cloudflare");
        const ctx = getCloudflareContext();
        const secret = ctx?.env?.TRAKT_CLIENT_SECRET;
        if (typeof secret === "string" && secret) return secret;
    } catch { /* not running on Cloudflare */ }

    return undefined;
}

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
    const clientSecret = getTraktSecret();

    if (!clientId || !clientSecret) {
        console.error("[trakt] Missing env:", {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
        });
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
        console.error("[trakt] Token exchange failed:", {
            error: error instanceof Error ? error.message : error,
            redirectUri,
            appUrl: getAppUrl(),
        });
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=exchange", getAppUrl()));
    }
}
