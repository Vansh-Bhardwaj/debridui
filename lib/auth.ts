import type { createNeonAuth } from "@neondatabase/auth/next/server";

type NeonAuth = ReturnType<typeof createNeonAuth>;
let _auth: NeonAuth | null = null;

// Lazily create the Neon Auth instance on first use (not at import time)
// to avoid paying the initialization cost on routes that import but don't call auth.
function getAuth(): NeonAuth {
    if (!_auth) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createNeonAuth } = require("@neondatabase/auth/next/server") as typeof import("@neondatabase/auth/next/server");
        _auth = createNeonAuth({
            baseUrl: process.env.NEON_AUTH_BASE_URL!,
            cookies: {
                secret: process.env.NEON_AUTH_COOKIE_SECRET!,
                // Cache session data for 10 minutes to reduce auth server round-trips
                sessionDataTtl: 600,
            },
        });
    }
    return _auth;
}

// Proxy that defers initialization until first property access
export const auth: NeonAuth = new Proxy({} as NeonAuth, {
    get(_, prop) {
        return (getAuth() as unknown as Record<string | symbol, unknown>)[prop];
    },
});
