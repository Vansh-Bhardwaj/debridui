import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getAppUrl, getEnv } from "@/lib/env";
import type { AuthCheck, BuildCheck, DbCheck, EnvCheck, HealthResponse, CheckStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

const getStatusFromList = (statuses: CheckStatus[]): CheckStatus => {
    if (statuses.includes("error")) return "error";
    if (statuses.includes("degraded")) return "degraded";
    return "ok";
};

const buildEnvCheck = (): EnvCheck => {
    const appUrl = getAppUrl();
    const hasDb = !!getEnv("DATABASE_URL");
    const hasAuthUrl = !!getEnv("NEXT_PUBLIC_NEON_AUTH_URL");
    const hasAuthSecret = !!getEnv("NEON_AUTH_COOKIE_SECRET");
    const googleOAuthEnabled = true; // Handled by Neon Console

    const missing: string[] = [];
    if (!hasDb) missing.push("DATABASE_URL");
    if (!hasAuthUrl) missing.push("NEXT_PUBLIC_NEON_AUTH_URL");
    if (!hasAuthSecret) missing.push("NEON_AUTH_COOKIE_SECRET");

    const warnings: string[] = [];
    if (process.env.NODE_ENV === "production" && appUrl.includes("localhost")) {
        warnings.push("APP_URL/NEXT_PUBLIC_APP_URL points to localhost");
    }

    const status: CheckStatus = missing.length > 0 ? "error" : warnings.length > 0 ? "degraded" : "ok";

    return {
        status,
        ok: status === "ok",
        appUrl,
        googleOAuthEnabled,
        missing,
        warnings,
    };
};

const buildAuthCheck = (): AuthCheck => {
    const baseUrl = getEnv("NEXT_PUBLIC_NEON_AUTH_URL") || "Not set";
    const hasAuthSecret = !!getEnv("NEON_AUTH_COOKIE_SECRET");
    const googleOAuthEnabled = true; // Handled by Neon Console

    const warnings: string[] = [];
    const errors: string[] = [];

    if (!hasAuthSecret) errors.push("NEON_AUTH_COOKIE_SECRET missing");
    if (process.env.NODE_ENV === "production" && baseUrl.includes("localhost")) {
        warnings.push("Auth Base URL is localhost in production");
    }

    const status: CheckStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "degraded" : "ok";

    return {
        status,
        ok: status === "ok",
        baseUrl,
        cookiePrefix: "neon-auth",
        googleOAuthEnabled,
        warnings,
        errors,
    };
};

const buildBuildCheck = (): BuildCheck => {
    const buildTime = getEnv("NEXT_PUBLIC_BUILD_TIME");
    const nodeEnv = getEnv("NODE_ENV");
    const status: CheckStatus = "ok";

    return {
        status,
        ok: true,
        nodeEnv,
        buildTime,
    };
};

const buildDbCheck = async (): Promise<DbCheck> => {
    const databaseUrl = getEnv("DATABASE_URL");
    if (!databaseUrl) {
        return {
            status: "error",
            ok: false,
            error: "DATABASE_URL is not set",
        };
    }

    let host: string | undefined;
    let port: string | undefined;
    try {
        const parsed = new URL(databaseUrl);
        host = parsed.hostname;
        port = parsed.port || "5432";
    } catch {
        return {
            status: "error",
            ok: false,
            error: "DATABASE_URL is invalid",
        };
    }

    const started = Date.now();
    try {
        await db.execute(sql`select 1 as ok`);
        const latencyMs = Date.now() - started;
        return {
            status: "ok",
            ok: true,
            host,
            port,
            latencyMs,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown database error";
        return {
            status: "error",
            ok: false,
            host,
            port,
            error: message,
        };
    }
};

export async function GET() {
    const time = new Date().toISOString();

    const envCheck = buildEnvCheck();
    const authCheck = buildAuthCheck();
    const buildCheck = buildBuildCheck();
    const dbCheck = await buildDbCheck();

    const status = getStatusFromList([envCheck.status, authCheck.status, buildCheck.status, dbCheck.status]);

    const response: HealthResponse = {
        status,
        time,
        checks: {
            env: envCheck,
            db: dbCheck,
            auth: authCheck,
            build: buildCheck,
        },
    };

    const httpStatus = status === "error" ? 503 : 200;

    return NextResponse.json(response, {
        status: httpStatus,
        headers: {
            "Cache-Control": "no-store, max-age=0",
        },
    });
}
