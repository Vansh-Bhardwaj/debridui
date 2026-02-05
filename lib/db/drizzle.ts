import "@/lib/polyfills";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import { neon, Pool } from "@neondatabase/serverless";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";
import { getEnv } from "@/lib/env";

/** Minimal Hyperdrive interface (the full type lives in gitignored cloudflare-env.d.ts) */
interface HyperdriveBinding {
    connectionString: string;
}

/** Context returned by getCloudflareContext */
interface CloudflareContext {
    env?: {
        HYPERDRIVE?: HyperdriveBinding;
        DATABASE_URL?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

type DbType = ReturnType<typeof drizzleHttp> | ReturnType<typeof drizzleServerless>;

// Per-request database instance cache using WeakMap keyed by request context
const dbCache = new WeakMap<object, DbType>();
let fallbackDbInstance: DbType | null = null;

const drizzleConfig = {
    schema: {
        ...schema,
        ...authSchema,
    },
};

/**
 * Get Cloudflare context safely (returns null outside Workers / during build)
 */
function getCloudflareCtx(): CloudflareContext | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getCloudflareContext } = require("@opennextjs/cloudflare");
        return getCloudflareContext() ?? null;
    } catch {
        // Not in Cloudflare context (local dev or build time)
        return null;
    }
}

/**
 * Resolve a database connection string from available sources.
 * Priority: Hyperdrive → process.env.DATABASE_URL → ctx.env.DATABASE_URL
 */
function resolveConnectionInfo(): {
    connectionString: string;
    source: "hyperdrive" | "env" | "ctx-env";
} {
    const ctx = getCloudflareCtx();

    // 1. Hyperdrive binding (preferred in production for connection pooling)
    if (ctx?.env?.HYPERDRIVE?.connectionString) {
        return {
            connectionString: ctx.env.HYPERDRIVE.connectionString,
            source: "hyperdrive",
        };
    }

    // 2. process.env.DATABASE_URL (local dev + OpenNext-bridged secrets)
    const envUrl = getEnv("DATABASE_URL");
    if (envUrl) {
        return { connectionString: envUrl, source: "env" };
    }

    // 3. Cloudflare context env.DATABASE_URL (failsafe for un-bridged secrets)
    const ctxUrl = ctx?.env?.DATABASE_URL;
    if (typeof ctxUrl === "string" && ctxUrl) {
        return { connectionString: ctxUrl, source: "ctx-env" };
    }

    // Build a descriptive error so logs reveal exactly what's missing
    const details = [
        `Hyperdrive binding: ${ctx?.env?.HYPERDRIVE ? "exists but connectionString is empty" : "not available"}`,
        `process.env.DATABASE_URL: ${envUrl === undefined ? "not set" : "empty"}`,
        `ctx.env.DATABASE_URL: ${ctxUrl === undefined ? "not set" : "empty"}`,
        `Cloudflare context: ${ctx ? "available" : "not available"}`,
    ].join(", ");

    throw new Error(`[db] No database connection available. ${details}`);
}

/**
 * Create a database instance for the current request context.
 * Uses Hyperdrive in production (TCP pool via serverless driver),
 * or neon-http over DATABASE_URL for local dev / fallback.
 */
function createDbInstance(): { db: DbType; source: string } {
    const { connectionString, source } = resolveConnectionInfo();

    // Log the connection source (production-only to reduce noise)
    if (process.env.NODE_ENV === "production") {
        try {
            const u = new URL(connectionString);
            console.log(`[db] Connected via ${source}`, { host: u.hostname, port: u.port || "5432" });
        } catch {
            console.log(`[db] Connected via ${source} (URL parse failed)`);
        }
    }

    if (source === "hyperdrive") {
        // Hyperdrive provides a local TCP proxy — use the serverless driver with Pool
        const pool = new Pool({ connectionString });
        return { db: drizzleServerless(pool, drizzleConfig), source };
    }

    // Fallback: neon-http driver (stateless HTTP queries, works everywhere)
    const sql = neon(connectionString);
    return { db: drizzleHttp(sql, drizzleConfig), source };
}

/**
 * Get database instance for the current request.
 * Caches per-request in Cloudflare Workers, uses singleton for local dev.
 */
export function getDb(): DbType {
    // Try to get Cloudflare context for per-request caching
    const ctx = getCloudflareCtx();

    if (ctx) {
        const cached = dbCache.get(ctx);
        if (cached) return cached;

        const { db } = createDbInstance();
        dbCache.set(ctx, db);
        return db;
    }

    // Local dev: use singleton
    if (!fallbackDbInstance) {
        const { db } = createDbInstance();
        fallbackDbInstance = db;
    }
    return fallbackDbInstance;
}

// Support existing imports with lazy evaluation per-request
export const db = new Proxy({} as unknown as DbType, {
    get(_target, prop: string | symbol) {
        const instance = getDb();
        return (instance as unknown as Record<string | symbol, unknown>)[prop];
    },
});

/**
 * Get current database connection diagnostics for health checks.
 * Non-throwing — always returns info about available sources.
 */
export function getDbConnectionInfo(): {
    source: string;
    hyperdriveAvailable: boolean;
    hyperdriveHasConnectionString: boolean;
    hasProcessEnvDbUrl: boolean;
    hasCtxEnvDbUrl: boolean;
    cloudflareContext: boolean;
    host?: string;
    port?: string;
    error?: string;
} {
    try {
        const ctx = getCloudflareCtx();
        const hd = ctx?.env?.HYPERDRIVE;
        const processEnvDbUrl = getEnv("DATABASE_URL");
        const ctxEnvDbUrl = typeof ctx?.env?.DATABASE_URL === "string" ? ctx.env.DATABASE_URL : undefined;

        // Determine which source would be used
        let source = "none";
        let connStr: string | undefined;
        if (hd?.connectionString) {
            source = "hyperdrive";
            connStr = hd.connectionString;
        } else if (processEnvDbUrl) {
            source = "env";
            connStr = processEnvDbUrl;
        } else if (ctxEnvDbUrl) {
            source = "ctx-env";
            connStr = ctxEnvDbUrl;
        }

        let host: string | undefined;
        let port: string | undefined;
        if (connStr) {
            try {
                const u = new URL(connStr);
                host = u.hostname;
                port = u.port || "5432";
            } catch { /* URL parse failed */ }
        }

        return {
            source,
            hyperdriveAvailable: !!hd,
            hyperdriveHasConnectionString: !!hd?.connectionString,
            hasProcessEnvDbUrl: !!processEnvDbUrl,
            hasCtxEnvDbUrl: !!ctxEnvDbUrl,
            cloudflareContext: !!ctx,
            host,
            port,
        };
    } catch (error) {
        return {
            source: "error",
            hyperdriveAvailable: false,
            hyperdriveHasConnectionString: false,
            hasProcessEnvDbUrl: false,
            hasCtxEnvDbUrl: false,
            cloudflareContext: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
