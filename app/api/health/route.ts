import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, getDbConnectionInfo } from "@/lib/db";
import { getAppUrl, getEnv } from "@/lib/env";
import type { AuthCheck, BuildCheck, DbCheck, EnvCheck, HyperdriveCheck, HealthResponse, CheckStatus } from "@/lib/health";

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

    // Check if Hyperdrive provides database connectivity (DATABASE_URL not needed)
    const connInfo = getDbConnectionInfo();
    const hyperdriveHandlesDb = connInfo.source === "hyperdrive" || connInfo.source === "ctx-env";

    const missing: string[] = [];
    if (!hasDb && !hyperdriveHandlesDb) missing.push("DATABASE_URL");
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
    // In production on Workers, DATABASE_URL may not be in process.env
    // but the db proxy handles connection resolution internally
    const connInfo = getDbConnectionInfo();
    const hasAnyConnection = connInfo.source !== "none" && connInfo.source !== "error";

    if (!databaseUrl && !hasAnyConnection) {
        return {
            status: "error",
            ok: false,
            error: `No database connection available (source: ${connInfo.source})`,
        };
    }

    const host = connInfo.host;
    const port = connInfo.port;

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

const buildHyperdriveCheck = (): HyperdriveCheck => {
    const info = getDbConnectionInfo();

    // Hyperdrive is "ok" when it's the active source
    // "degraded" when Cloudflare context exists but Hyperdrive isn't available (using fallback)
    // "ok" in local dev where Hyperdrive isn't expected
    let status: CheckStatus;
    if (info.source === "hyperdrive") {
        status = "ok";
    } else if (info.cloudflareContext && !info.hyperdriveAvailable) {
        // On Workers but Hyperdrive binding missing
        status = "error";
    } else if (info.cloudflareContext && info.hyperdriveAvailable && !info.hyperdriveHasConnectionString) {
        // Binding exists but connectionString is empty
        status = "degraded";
    } else if (!info.cloudflareContext) {
        // Local dev — Hyperdrive not expected
        status = "ok";
    } else {
        status = "degraded";
    }

    return {
        status,
        ok: status === "ok",
        source: info.source,
        hyperdriveAvailable: info.hyperdriveAvailable,
        hyperdriveHasConnectionString: info.hyperdriveHasConnectionString,
        hasProcessEnvDbUrl: info.hasProcessEnvDbUrl,
        hasCtxEnvDbUrl: info.hasCtxEnvDbUrl,
        cloudflareContext: info.cloudflareContext,
        host: info.host,
        port: info.port,
        error: info.error,
    };
};

export async function GET() {
    const time = new Date().toISOString();

    const envCheck = buildEnvCheck();
    const authCheck = buildAuthCheck();
    const buildCheck = buildBuildCheck();
    const dbCheck = await buildDbCheck();
    const hyperdriveCheck = buildHyperdriveCheck();

    const status = getStatusFromList([envCheck.status, authCheck.status, buildCheck.status, dbCheck.status, hyperdriveCheck.status]);

    const response: HealthResponse = {
        status,
        time,
        checks: {
            env: envCheck,
            db: dbCheck,
            auth: authCheck,
            build: buildCheck,
            hyperdrive: hyperdriveCheck,
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
