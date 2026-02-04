import { createNeonAuth } from "@neondatabase/auth/next/server";

// Create the Neon Auth instance for server-side operations
export const auth = createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!,
    cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!,
    },
});
