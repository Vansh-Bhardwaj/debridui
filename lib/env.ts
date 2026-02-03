const envValue = (key: string): string | undefined => {
    return process.env[key];
};

export const getEnv = (key: string): string | undefined => envValue(key);

export const getRequiredEnv = (key: string): string => {
    const value = envValue(key);
    if (!value) {
        throw new Error(`[env] Missing ${key}`);
    }
    return value;
};

export const getAppUrl = (): string => {
    return envValue("APP_URL") || envValue("NEXT_PUBLIC_APP_URL") || "http://localhost:3000";
};
