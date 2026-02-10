import { z } from "zod";

export enum AccountType {
    REALDEBRID = "real-debrid",
    TORBOX = "torbox",
    ALLDEBRID = "alldebrid",
    PREMIUMIZE = "premiumize",
}

// Account schemas (base → inherited)
export const accountSchema = z.object({
    type: z.nativeEnum(AccountType, { message: "Invalid account type" }),
    apiKey: z.string().trim().min(1, "API key is required"),
});

export const createAccountSchema = accountSchema.extend({
    name: z.string().trim().min(1, "Account name is required"),
});

export const userSchema = accountSchema.extend({
    id: z.string().trim().min(1).default(crypto.randomUUID()),
    name: z.string().trim().min(1),
    email: z.string().trim().min(1),
    language: z.string().trim().min(1),
    isPremium: z.boolean(),
    premiumExpiresAt: z.date(),
});

export const addUserSchema = accountSchema;

// Addon schemas
export const addonSchema = z.object({
    name: z.string().trim().min(1, "Addon name is required"),
    url: z.string().url("Invalid addon URL").trim(),
    enabled: z.boolean(),
});

export const addonOrderUpdateSchema = z.array(
    z.object({
        id: z.string().min(1, "Addon ID is required"),
        order: z.number().int().min(0, "Order must be a non-negative integer"),
    }),
);

// User settings schema (snake_case for DB storage)
export const serverSettingsSchema = z.object({
    tmdb_api_key: z.string().max(256).optional(),
    trakt_access_token: z.string().max(512).optional(),
    trakt_refresh_token: z.string().max(512).optional(),
    trakt_expires_at: z.number().optional(),
});
