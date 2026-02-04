import "@/lib/polyfills";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import { neon, Pool } from "@neondatabase/serverless";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";
import { getEnv } from "@/lib/env";

let dbInstance: any = null;

// Get database connection string - uses Hyperdrive in production
function getDatabaseUrl(): string {
    // In Cloudflare Workers, Hyperdrive binding provides the connection string
    // @ts-expect-error - Hyperdrive binding is injected by Cloudflare Workers
    if (typeof globalThis.HYPERDRIVE !== "undefined" && globalThis.HYPERDRIVE?.connectionString) {
        // @ts-expect-error - Hyperdrive binding is injected by Cloudflare Workers
        return globalThis.HYPERDRIVE.connectionString;
    }

    // Fallback to DATABASE_URL for local dev
    const databaseUrl = getEnv("DATABASE_URL");
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is not set and Hyperdrive is not available");
    }
    return databaseUrl;
}

type DbType = ReturnType<typeof drizzleHttp> | ReturnType<typeof drizzleServerless>;

export function getDb(): DbType {
    if (dbInstance) return dbInstance;

    const databaseUrl = getDatabaseUrl();
    // @ts-expect-error - indexing globalThis
    const isHyperdrive = databaseUrl.includes("hyperdrive") || (typeof globalThis["HYPERDRIVE"] !== "undefined");

    if (process.env.NODE_ENV === "production") {
        try {
            const dbUrl = new URL(databaseUrl);
            console.log("[db] init", {
                host: dbUrl.hostname,
                port: dbUrl.port || "5432",
                viaHyperdrive: isHyperdrive
            });
        } catch (error) {
            console.warn("[db] Failed to parse DATABASE_URL or Hyperdrive URL", error);
        }
    }

    const drizzleConfig = {
        schema: {
            ...schema,
            ...authSchema,
        },
    };

    // Use TCP driver (Serverless Pool) for Hyperdrive to enable TCP pooling
    // Use HTTP driver for local dev or standard Neon connections
    if (isHyperdrive && process.env.NODE_ENV === "production") {
        const pool = new Pool({ connectionString: databaseUrl });
        dbInstance = drizzleServerless(pool, drizzleConfig);
    } else {
        const sql = neon(databaseUrl);
        dbInstance = drizzleHttp(sql, drizzleConfig);
    }

    return dbInstance;
}

// Support existing imports
export const db = new Proxy({} as unknown as DbType, {
    get(_target, prop: keyof DbType) {
        const instance = getDb();
        return (instance as any)[prop];
    }
});
