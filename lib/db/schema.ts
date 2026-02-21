import { relations } from "drizzle-orm";
import { pgTable, text, boolean, integer, timestamp, jsonb, uniqueIndex, index, uuid } from "drizzle-orm/pg-core";
import { AccountType } from "../schemas";
export * from "./auth-schema";
import { user } from "./auth-schema";

// User accounts table - stores debrid service accounts
export const userAccounts = pgTable(
    "user_accounts",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        apiKey: text("api_key").notNull(),
        type: text("type", { enum: Object.values(AccountType) as [string, ...string[]] }).notNull(),
        name: text("name").notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("unique_user_account").on(table.userId, table.apiKey, table.type),
        index("user_accounts_userId_idx").on(table.userId),
    ]
);

// Addons table - stores user addon configurations
export const addons = pgTable(
    "addons",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        url: text("url").notNull(),
        enabled: boolean("enabled").notNull().default(true),
        order: integer("order").notNull().default(0),
        showCatalogs: boolean("show_catalogs").notNull().default(false),
    },
    (table) => [index("addons_userId_idx").on(table.userId)]
);

// User settings table - stores user preferences
export const userSettings = pgTable("user_settings", {
    userId: uuid("user_id")
        .primaryKey()
        .references(() => user.id, { onDelete: "cascade" }),
    settings: jsonb("settings").notNull(),
});

// User progress table - stores watch progress for continue watching feature
// Optimized: writes only on 60s intervals + pause/end events
export const userProgress = pgTable(
    "user_progress",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        imdbId: text("imdb_id").notNull(),
        type: text("type", { enum: ["movie", "show"] }).notNull(),
        season: integer("season"),
        episode: integer("episode"),
        progressSeconds: integer("progress_seconds").notNull().default(0),
        durationSeconds: integer("duration_seconds").notNull().default(0),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("unique_user_progress").on(table.userId, table.imdbId, table.season, table.episode),
        index("user_progress_userId_idx").on(table.userId),
        index("user_progress_updated_at_idx").on(table.updatedAt),
    ]
);

// Watch history table - append-only log of completed/significant play sessions
export const watchHistory = pgTable(
    "watch_history",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        imdbId: text("imdb_id").notNull(),
        type: text("type", { enum: ["movie", "show"] }).notNull(),
        season: integer("season"),
        episode: integer("episode"),
        fileName: text("file_name"),
        progressSeconds: integer("progress_seconds").notNull().default(0),
        durationSeconds: integer("duration_seconds").notNull().default(0),
        watchedAt: timestamp("watched_at").notNull().defaultNow(),
    },
    (table) => [
        index("watch_history_userId_idx").on(table.userId),
        index("watch_history_watchedAt_idx").on(table.watchedAt),
    ]
);

// Relations
export const userRelations = relations(user, ({ many, one }) => ({
    userAccounts: many(userAccounts),
    addons: many(addons),
    userSettings: one(userSettings),
    userProgress: many(userProgress),
    watchHistory: many(watchHistory),
}));

export const userAccountsRelations = relations(userAccounts, ({ one }) => ({
    user: one(user, {
        fields: [userAccounts.userId],
        references: [user.id],
    }),
}));

export const addonsRelations = relations(addons, ({ one }) => ({
    user: one(user, {
        fields: [addons.userId],
        references: [user.id],
    }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
    user: one(user, {
        fields: [userSettings.userId],
        references: [user.id],
    }),
}));

export const userProgressRelations = relations(userProgress, ({ one }) => ({
    user: one(user, {
        fields: [userProgress.userId],
        references: [user.id],
    }),
}));

// Type exports for TypeScript
export type UserAccount = typeof userAccounts.$inferSelect;
export type NewUserAccount = typeof userAccounts.$inferInsert;
export type Addon = typeof addons.$inferSelect;
export type NewAddon = typeof addons.$inferInsert;
export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
export type UserProgress = typeof userProgress.$inferSelect;
export type NewUserProgress = typeof userProgress.$inferInsert;
export type WatchHistory = typeof watchHistory.$inferSelect;
export type NewWatchHistory = typeof watchHistory.$inferInsert;