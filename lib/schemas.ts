// zod/mini: same validation, a fraction of the Worker bundle (full zod is ~100 KB per server chunk group).
import { z } from "zod/mini";

export enum AccountType {
    REALDEBRID = "real-debrid",
    TORBOX = "torbox",
    ALLDEBRID = "alldebrid",
    PREMIUMIZE = "premiumize",
}

// Account schemas (base → inherited)
export const accountSchema = z.object({
    type: z.enum(AccountType, "Invalid account type"),
    apiKey: z.string().check(z.trim(), z.minLength(1, "API key is required")),
});

export const createAccountSchema = z.extend(accountSchema, {
    name: z.string().check(z.trim(), z.minLength(1, "Account name is required")),
});

const nonEmpty = () => z.string().check(z.trim(), z.minLength(1));
export const userSchema = z.extend(accountSchema, {
    id: z._default(nonEmpty(), crypto.randomUUID()),
    name: nonEmpty(),
    email: nonEmpty(),
    language: nonEmpty(),
    isPremium: z.boolean(),
    premiumExpiresAt: z.date(),
});

export const addUserSchema = accountSchema;

// Addon schemas
export const addonSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1, "Addon name is required")),
    url: z.url("Invalid addon URL").check(z.trim()),
    enabled: z.boolean(),
});

export const addonOrderUpdateSchema = z.array(
    z.object({
        id: z.string().check(z.minLength(1, "Addon ID is required")),
        order: z.int().check(z.gte(0, "Order must be a non-negative integer")),
    }),
);

// User settings schema (snake_case for DB storage)
export const serverSettingsSchema = z.object({
    tmdb_api_key: z.optional(z.string().check(z.maxLength(256))),
    trakt_access_token: z.optional(z.string().check(z.maxLength(512))),
    trakt_refresh_token: z.optional(z.string().check(z.maxLength(512))),
    trakt_expires_at: z.optional(z.number()),
});

export const profileIdSchema = z.uuid("Invalid profile ID");
export const createProfileSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1, "Profile name is required"), z.maxLength(50)),
    avatar: z.optional(z.nullable(z.string().check(z.trim(), z.maxLength(2048)))),
    color: z.optional(z.nullable(z.string().check(z.regex(/^#[0-9a-f]{6}$/i, "Use a hex color")))),
});
export const updateProfileSchema = z.partial(createProfileSchema);
export const profilePreferencesSchema = z.record(z.string().check(z.maxLength(100)), z.unknown()).check(z.refine(
    (value) => JSON.stringify(value).length <= 16_384 && !Object.keys(value).some((key) => key === "tmdb_api_key" || key.startsWith("trakt_")),
    "Preferences must exclude account keys and Trakt tokens and fit within 16KB",
));
