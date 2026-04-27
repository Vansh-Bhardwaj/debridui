import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware for instant auth-aware routing.
 *
 * Checks for the session cookie set by better-auth. If present on public
 * auth-entry pages (/, /login, /signup, etc.), immediately redirects to
 * /dashboard — no page render, no flash. This gives the Netflix/Google
 * experience of never seeing a landing page when logged in.
 *
 * The cookie presence check is intentionally lightweight (no DB hit).
 * If the cookie is stale, the AuthProvider on /dashboard will handle
 * proper validation and redirect back to /login if needed.
 */

const SESSION_COOKIE_NAMES = [
    "better-auth.session_token",
    "debridui.session_token",
    "__session",
];

const PUBLIC_AUTH_PATHS = new Set([
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
]);

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Only intercept public auth-entry pages
    if (!PUBLIC_AUTH_PATHS.has(pathname)) return NextResponse.next();

    // Check for any valid session cookie
    const hasSession = SESSION_COOKIE_NAMES.some(
        (name) => request.cookies.has(name)
    );

    if (hasSession) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url, 307);
    }

    return NextResponse.next();
}

export const config = {
    // Only run on the specific public pages — skip API routes, _next, static files
    matcher: ["/", "/login", "/signup", "/forgot-password", "/reset-password"],
};
