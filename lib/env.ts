// Server-only env access. Secrets set via `wrangler secret put` are not always
// bridged into process.env by OpenNext, so fall back to the Cloudflare context.
type CfEnv = Record<string, unknown>;
let getCfContext: (() => { env?: CfEnv } | null) | null | undefined;

export function getCfEnv(): CfEnv | undefined {
    if (getCfContext === undefined) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            getCfContext = require("@opennextjs/cloudflare").getCloudflareContext;
        } catch {
            getCfContext = null;
        }
    }
    try {
        return getCfContext?.()?.env;
    } catch {
        return undefined; // outside a request / during build
    }
}

export const getEnv = (key: string): string | undefined => {
    const value = process.env[key];
    if (value) return value;
    const cfValue = getCfEnv()?.[key];
    return typeof cfValue === "string" && cfValue ? cfValue : undefined;
};

export const getRequiredEnv = (key: string): string => {
    const value = getEnv(key);
    if (!value) {
        throw new Error(`[env] Missing ${key}`);
    }
    return value;
};

export const getAppUrl = (): string => {
    return getEnv("APP_URL") || getEnv("NEXT_PUBLIC_APP_URL") || "http://localhost:3000";
};
