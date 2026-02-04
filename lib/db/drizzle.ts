import "@/lib/polyfills";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";
import { getEnv } from "@/lib/env";

let dbInstance: ReturnType<typeof drizzle> | null = null;

type DbType = ReturnType<typeof drizzle>;

export function getDb() {
    if (dbInstance) return dbInstance;

    const databaseUrl = getEnv("DATABASE_URL");

    if (!databaseUrl) {
        console.error("[db] DATABASE_URL is not set");
        throw new Error("DATABASE_URL is not set");
    }

    if (process.env.NODE_ENV === "production") {
        try {
            const dbUrl = new URL(databaseUrl);
            console.log("[db] init", { host: dbUrl.hostname, port: dbUrl.port || "5432" });
        } catch (error) {
            console.warn("[db] Failed to parse DATABASE_URL", error);
        }
    }

    // Neon HTTP driver is Cloudflare Workers compatible (no TCP sockets)
    const sql = neon(databaseUrl);
    dbInstance = drizzle(sql, {
        schema: {
            ...schema,
            ...authSchema,
        },
    });

    return dbInstance;
}

// Support existing imports
export const db = new Proxy({} as unknown as DbType, {
    get(_target, prop: keyof DbType) {
        const instance = getDb() as DbType;
        return instance[prop];
    }
});
