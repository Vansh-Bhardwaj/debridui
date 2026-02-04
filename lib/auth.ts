import "@/lib/polyfills";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { multiSession } from "better-auth/plugins";
import { db } from "@/lib/db";
import { v7 as uuidv7 } from "uuid";
import { getEnv, getAppUrl } from "@/lib/env";

const googleClientId = getEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID") || "";
const googleClientSecret = getEnv("GOOGLE_CLIENT_SECRET") || "";
const isGoogleOAuthEnabled = !!(googleClientId && googleClientSecret);
const isEmailSignupDisabled = getEnv("NEXT_PUBLIC_DISABLE_EMAIL_SIGNUP") === "true";
const appURL = getAppUrl();

// Allow multiple origins for flexibility (workers.dev + custom domain)
const trustedOrigins = [
    appURL,
    "http://localhost:3000",
    "https://debridui.vanshbh7102-619.workers.dev",
    "https://debrid.indevs.in",
].filter(Boolean);

if (process.env.NODE_ENV === "production") {
    // Helpful runtime diagnostics in Cloudflare logs
    console.log("[auth] init", {
        appURL,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasBetterAuthSecret: !!process.env.BETTER_AUTH_SECRET,
        hasGoogleClientId: !!googleClientId,
        hasGoogleClientSecret: !!googleClientSecret,
    });
}

export const auth = betterAuth({
    baseURL: appURL,
    trustedOrigins: trustedOrigins,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    user: {
        deleteUser: {
            enabled: true,
        },
    },
    emailAndPassword: {
        enabled: true,
        disableSignUp: isEmailSignupDisabled,
    },
    socialProviders: isGoogleOAuthEnabled
        ? {
            google: {
                clientId: googleClientId,
                clientSecret: googleClientSecret,
            },
        }
        : undefined,
    session: {
        expiresIn: 60 * 60 * 24 * 365, // 1 year in seconds
        updateAge: 60 * 60 * 24 * 7, // Update session every 7 days
        cookieCache: {
            enabled: true,
            maxAge: 5 * 60, // 5 minutes - prevents stale session after logout
            strategy: "jwt",
        },
    },
    advanced: {
        database: {
            generateId: () => uuidv7(),
        },
        cookiePrefix: "debridui",
    },
    plugins: [
        nextCookies(),
        // Enable multi-device login: same account on unlimited devices
        multiSession({
            maximumSessions: 10, // Allow up to 10 active sessions per user
        }),
    ],
});
