import "@/lib/polyfills";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";
import { getEnv } from "@/lib/env";

/**
 * Minimal type for Cloudflare Hyperdrive binding.
 * The real type comes from cloudflare-env.d.ts which is gitignored.
 */
interface HyperdriveBinding {
    connectionString: string;
}

/**
 * Context returned by getCloudflareContext.
 * Cloudflare-env.d.ts is gitignored so we define a minimal shape here.
 */
interface CloudflareContext {
    env?: {
        HYPERDRIVE?: HyperdriveBinding;
        DATABASE_URL?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

type DbType = ReturnType<typeof drizzlePg>;

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
        return null;
    }
}

/**
 * Resolve a database connection string from available sources.
 *
 * Priority:
 *   1. Hyperdrive binding (TCP proxy with connection pooling + caching)
 *   2. process.env.DATABASE_URL (local dev / OpenNext-bridged vars)
 *   3. ctx.env.DATABASE_URL (un-bridged wrangler vars/secrets)
 *
 * Hyperdrive provides a local TCP proxy connection string (*.hyperdrive.local)
 * with sslmode=disable. SSL is terminated inside Cloudflare's infrastructure:
 *   Worker → Hyperdrive (internal, no SSL) → Neon Database (SSL enabled)
 */
function resolveConnection(): {
    url: string;
    source: "hyperdrive" | "env" | "ctx-env";
    viaHyperdrive: boolean;
} {
    const ctx = getCloudflareCtx();

    // 1. Hyperdrive binding — best performance (connection pooling + caching)
    const hyperdrive = ctx?.env?.HYPERDRIVE;
    if (hyperdrive?.connectionString) {
        return { url: hyperdrive.connectionString, source: "hyperdrive", viaHyperdrive: true };
    }

    // 2. process.env.DATABASE_URL (local dev + OpenNext-bridged vars/secrets)
    const envUrl = getEnv("DATABASE_URL");
    if (envUrl) {
        return { url: envUrl, source: "env", viaHyperdrive: false };
    }

    // 3. Cloudflare context env.DATABASE_URL (un-bridged wrangler vars/secrets)
    const ctxUrl = ctx?.env?.DATABASE_URL;
    if (typeof ctxUrl === "string" && ctxUrl) {
        return { url: ctxUrl, source: "ctx-env", viaHyperdrive: false };
    }

    const details = [
        `Hyperdrive: ${hyperdrive ? "binding exists but no connectionString" : "not bound"}`,
        `process.env.DATABASE_URL: ${envUrl === undefined ? "not set" : "empty"}`,
        `ctx.env.DATABASE_URL: ${ctxUrl === undefined ? "not set" : "empty"}`,
        `Cloudflare context: ${ctx ? "available" : "not available"}`,
    ].join(", ");

    throw new Error(`[db] No database connection available. ${details}`);
}

/**
 * Create a drizzle database instance using postgres-js driver.
 *
 * Uses the `postgres` (Postgres.js) library which connects via TCP.
 * When Hyperdrive is available, it connects through Cloudflare's local TCP proxy
 * for connection pooling, query caching, and reduced latency.
 *
 * Important: `prepare: false` is required for Hyperdrive — it does not support
 * PostgreSQL extended protocol (prepared statements).
 */
function createDbInstance(): { db: DbType; source: string; viaHyperdrive: boolean } {
    const { url, source, viaHyperdrive } = resolveConnection();

    const sql = postgres(url, {
        // Hyperdrive doesn't support prepared statements (PostgreSQL extended protocol)
        prepare: false,
        // Idle timeout — Workers are short-lived, close connections promptly
        idle_timeout: 20,
        // Max connections per Worker instance
        max: 1,
    });

    if (process.env.NODE_ENV === "production") {
        try {
            const u = new URL(url);
            console.log(`[db] Connected via ${source}${viaHyperdrive ? " (hyperdrive)" : " (direct)"}`, {
                host: u.hostname,
                port: u.port || "5432",
            });
        } catch {
            console.log(`[db] Connected via ${source}${viaHyperdrive ? " (hyperdrive)" : " (direct)"}`);
        }
    }

    return { db: drizzlePg(sql, drizzleConfig), source, viaHyperdrive };
}

/**
 * Get database instance for the current request.
 * Caches per-request in Cloudflare Workers, uses singleton for local dev.
 */
export function getDb(): DbType {
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
    viaHyperdrive: boolean;
    hasHyperdriveBinding: boolean;
    hasProcessEnvDbUrl: boolean;
    hasCtxEnvDbUrl: boolean;
    cloudflareContext: boolean;
    host?: string;
    port?: string;
    error?: string;
} {
    try {
        const ctx = getCloudflareCtx();
        const hyperdrive = ctx?.env?.HYPERDRIVE;
        const processEnvDbUrl = getEnv("DATABASE_URL");
        const ctxEnvDbUrl = typeof ctx?.env?.DATABASE_URL === "string" ? ctx.env.DATABASE_URL : undefined;

        let source = "none";
        let connStr: string | undefined;
        let viaHyperdrive = false;

        if (hyperdrive?.connectionString) {
            source = "hyperdrive";
            connStr = hyperdrive.connectionString;
            viaHyperdrive = true;
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
            viaHyperdrive,
            hasHyperdriveBinding: !!hyperdrive,
            hasProcessEnvDbUrl: !!processEnvDbUrl,
            hasCtxEnvDbUrl: !!ctxEnvDbUrl,
            cloudflareContext: !!ctx,
            host,
            port,
        };
    } catch (error) {
        return {
            source: "error",
            viaHyperdrive: false,
            hasHyperdriveBinding: false,
            hasProcessEnvDbUrl: false,
            hasCtxEnvDbUrl: false,
            cloudflareContext: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
