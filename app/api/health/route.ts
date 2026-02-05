import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, getDbConnectionInfo } from "@/lib/db";
import { getAppUrl, getEnv } from "@/lib/env";
import type { AuthCheck, BuildCheck, DbCheck, DbConnectionCheck, EnvCheck, HealthResponse, CheckStatus } from "@/lib/health";

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

    // Check if ctx.env provides DATABASE_URL even if process.env doesn't
    const connInfo = getDbConnectionInfo();
    const hasDbAnySource = hasDb || connInfo.source === "ctx-env";

    const missing: string[] = [];
    if (!hasDbAnySource) missing.push("DATABASE_URL");
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
    const connInfo = getDbConnectionInfo();
    const hasAnyConnection = connInfo.source !== "none" && connInfo.source !== "error";

    if (!hasAnyConnection) {
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

const buildConnectionCheck = (): DbConnectionCheck => {
    const info = getDbConnectionInfo();

    let status: CheckStatus;
    if (info.source === "hyperdrive" || info.source === "env" || info.source === "ctx-env") {
        // Hyperdrive is ideal; env/ctx-env are acceptable fallbacks
        status = info.viaHyperdrive ? "ok" : "degraded";
    } else if (!info.cloudflareContext) {
        // Local dev — fine as long as process.env.DATABASE_URL works
        status = info.hasProcessEnvDbUrl ? "ok" : "error";
    } else {
        status = "error";
    }

    // If we're in local dev (no CF context), don't degrade just because no Hyperdrive
    if (!info.cloudflareContext && info.hasProcessEnvDbUrl) {
        status = "ok";
    }

    return {
        status,
        ok: status !== "error",
        source: info.source,
        viaHyperdrive: info.viaHyperdrive,
        hasHyperdriveBinding: info.hasHyperdriveBinding,
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
    const connectionCheck = buildConnectionCheck();

    const status = getStatusFromList([envCheck.status, authCheck.status, buildCheck.status, dbCheck.status, connectionCheck.status]);

    const response: HealthResponse = {
        status,
        time,
        checks: {
            env: envCheck,
            db: dbCheck,
            auth: authCheck,
            build: buildCheck,
            connection: connectionCheck,
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
