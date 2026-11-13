import { NextResponse } from "next/server";
import { getActor, UnauthorizedError } from "@/lib/auth/actor";
import { getAppUrl, getRequiredEnv } from "@/lib/env";
import { signProfile } from "@/lib/auth/profile-cookie";

export async function GET() {
    const actor = await getActor().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const state = `${await signProfile(actor.userId, actor.profileId, getRequiredEnv("NEON_AUTH_COOKIE_SECRET"))}.${crypto.randomUUID()}`;
    const url = new URL("https://trakt.tv/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", getRequiredEnv("NEXT_PUBLIC_TRAKT_CLIENT_ID"));
    url.searchParams.set("redirect_uri", `${getAppUrl()}/api/trakt/callback`);
    url.searchParams.set("state", state);
    const response = NextResponse.redirect(url);
    response.cookies.set("trakt_oauth_state", state, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
}
