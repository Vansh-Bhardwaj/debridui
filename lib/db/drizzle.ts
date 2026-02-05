import "@/lib/polyfills";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import { neon, Pool } from "@neondatabase/serverless";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";
import { getEnv } from "@/lib/env";

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
 * Get Hyperdrive binding from Cloudflare context (OpenNext)
 * In production on Cloudflare Workers, this accesses the HYPERDRIVE binding
 */
function getHyperdriveFromContext(): Hyperdrive | null {
    try {
        // Dynamic import to avoid build-time issues
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getCloudflareContext } = require("@opennextjs/cloudflare");
        const ctx = getCloudflareContext();
        return ctx?.env?.HYPERDRIVE ?? null;
    } catch {
        // Not in Cloudflare context (local dev or build time)
        return null;
    }
}

/**
 * Create a database instance for the current request context
 * Uses Hyperdrive in production Cloudflare Workers, falls back to DATABASE_URL
 */
function createDbInstance(): { db: DbType; isHyperdrive: boolean } {
    const hyperdrive = getHyperdriveFromContext();
    
    if (hyperdrive?.connectionString) {
        // Use Hyperdrive connection (TCP pooling via Serverless driver)
        const connectionString = hyperdrive.connectionString;
        
        if (process.env.NODE_ENV === "production") {
            try {
                const dbUrl = new URL(connectionString);
                console.log("[db] Using Hyperdrive", {
                    host: dbUrl.hostname,
                    port: dbUrl.port || "5432",
                });
            } catch {
                console.log("[db] Using Hyperdrive (URL parse failed)");
            }
        }
        
        const pool = new Pool({ connectionString });
        return {
            db: drizzleServerless(pool, drizzleConfig),
            isHyperdrive: true,
        };
    }

    // Fallback to DATABASE_URL for local dev
    const databaseUrl = getEnv("DATABASE_URL");
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is not set and Hyperdrive is not available");
    }

    if (process.env.NODE_ENV === "production") {
        try {
            const dbUrl = new URL(databaseUrl);
            console.log("[db] Using direct connection (no Hyperdrive)", {
                host: dbUrl.hostname,
                port: dbUrl.port || "5432",
            });
        } catch {
            console.warn("[db] Failed to parse DATABASE_URL");
        }
    }

    const sql = neon(databaseUrl);
    return {
        db: drizzleHttp(sql, drizzleConfig),
        isHyperdrive: false,
    };
}

/**
 * Get database instance for the current request
 * Caches per-request in Cloudflare Workers, uses singleton for local dev
 */
export function getDb(): DbType {
    // Try to get context for per-request caching
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getCloudflareContext } = require("@opennextjs/cloudflare");
        const ctx = getCloudflareContext();
        
        if (ctx) {
            // Use context as cache key for per-request isolation
            const cached = dbCache.get(ctx);
            if (cached) return cached;
            
            const { db } = createDbInstance();
            dbCache.set(ctx, db);
            return db;
        }
    } catch {
        // Not in Cloudflare context
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
    }
});
