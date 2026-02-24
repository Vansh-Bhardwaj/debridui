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
// Cache the require'd function to avoid repeated dynamic require overhead
let _getCfCtx: (() => { env?: Record<string, unknown> } | null) | undefined;

function getTraktSecret(): string | undefined {
    const fromEnv = getEnv("TRAKT_CLIENT_SECRET");
    if (fromEnv) return fromEnv;

    try {
        if (!_getCfCtx) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require("@opennextjs/cloudflare");
            _getCfCtx = mod.getCloudflareContext;
        }
        const ctx = _getCfCtx!();
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

    // Validate OAuth state parameter (CSRF protection)
    const state = request.nextUrl.searchParams.get("state");
    const cookies = request.headers.get("cookie") || "";
    const stateMatch = cookies.match(/(?:^|;\s*)trakt_oauth_state=([^;]+)/);
    const storedState = stateMatch?.[1];
    if (!state || !storedState || state !== storedState) {
        return NextResponse.redirect(new URL("/settings?trakt=error&reason=state_mismatch", getAppUrl()));
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
    const proxyUrl = getEnv("NEXT_PUBLIC_CORS_PROXY_URL");

    try {
        const tokens = await TraktClient.exchangeCode(code, clientId, clientSecret, redirectUri, proxyUrl);

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
