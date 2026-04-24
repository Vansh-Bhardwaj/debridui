import { NextRequest, NextResponse } from "next/server";

// Neon Auth session cookie names (from @neondatabase/auth/next/server).
// Prefix is constant; the session cookie is "<prefix>.session_token".
const SESSION_COOKIE_NAMES = ["__Secure-neon-auth.session_token", "neon-auth.session_token"];

const AUTH_ENTRY_ROUTES = new Set(["/", "/login", "/signup", "/forgot-password", "/reset-password"]);

/**
 * Netflix-style instant redirect for returning users: if the session cookie
 * is present on an auth-entry route, swap the response for /dashboard at the
 * edge before any HTML is served. The cookie is HttpOnly so a client-side
 * check can't do this — middleware is the only way to skip the landing flash.
 *
 * We only check cookie presence (not validity). If the cookie is expired /
 * invalid, the dashboard's AuthProvider will bounce back to /login. Worst
 * case one extra hop; best case (the common one) zero landing flash.
 */
export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (!AUTH_ENTRY_ROUTES.has(pathname)) return NextResponse.next();

    const hasSession = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
    if (!hasSession) return NextResponse.next();

    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url, 307);
}

export const config = {
    // Match only the auth-entry routes — keeps middleware off every asset/API call.
    matcher: ["/", "/login", "/signup", "/forgot-password", "/reset-password"],
};
