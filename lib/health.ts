export type CheckStatus = "ok" | "degraded" | "error";

export interface EnvCheck {
    status: CheckStatus;
    ok: boolean;
    appUrl: string;
    googleOAuthEnabled: boolean;
    missing: string[];
    warnings: string[];
}

export interface DbCheck {
    status: CheckStatus;
    ok: boolean;
    host?: string;
    port?: string;
    latencyMs?: number;
    error?: string;
}

export interface AuthCheck {
    status: CheckStatus;
    ok: boolean;
    baseUrl: string;
    cookiePrefix: string;
    googleOAuthEnabled: boolean;
    warnings: string[];
    errors: string[];
}

export interface BuildCheck {
    status: CheckStatus;
    ok: boolean;
    nodeEnv?: string;
    buildTime?: string;
}

export interface DbConnectionCheck {
    status: CheckStatus;
    ok: boolean;
    source: string;
    viaHyperdrive: boolean;
    hasHyperdriveBinding: boolean;
    hasProcessEnvDbUrl: boolean;
    hasCtxEnvDbUrl: boolean;
    cloudflareContext: boolean;
    host?: string;
    port?: string;
    error?: string;
}

export interface HealthResponse {
    status: CheckStatus;
    time: string;
    checks: {
        env: EnvCheck;
        db: DbCheck;
        auth: AuthCheck;
        build: BuildCheck;
        connection: DbConnectionCheck;
    };
}
