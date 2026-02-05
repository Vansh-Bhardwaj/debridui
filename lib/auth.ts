import { createNeonAuth } from "@neondatabase/auth/next/server";

// Create the Neon Auth instance for server-side operations
// sessionDataTtl controls how long session data is cached in a signed cookie
// before re-validating with the upstream auth server (in seconds)
export const auth = createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!,
    cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!,
        // Cache session data for 10 minutes to reduce auth server round-trips
        // and improve perceived session persistence
        sessionDataTtl: 600,
    },
});
