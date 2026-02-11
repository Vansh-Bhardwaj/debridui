"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { addons } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { addonSchema, addonOrderUpdateSchema } from "@/lib/schemas";
import { type CreateAddon } from "@/lib/types";
import { v7 as uuidv7 } from "uuid";

/**
 * Get all user addons from database
 */
export async function getUserAddons() {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const userAddons = await db.select().from(addons).where(eq(addons.userId, session.user.id)).orderBy(addons.order);

    return userAddons;
}

/**
 * Add a new addon — single query using subquery for order calculation
 */
export async function addAddon(data: CreateAddon) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const validated = addonSchema.parse(data);
    const newId = uuidv7();

    // Single INSERT with subquery for order — saves 1 DB query vs SELECT MAX + INSERT
    const [result] = await db
        .insert(addons)
        .values({
            id: newId,
            userId: session.user.id,
            name: validated.name,
            url: validated.url,
            enabled: validated.enabled,
            order: sql`(SELECT COALESCE(MAX(${addons.order}), -1) + 1 FROM ${addons} WHERE ${addons.userId} = ${session.user.id})`,
        })
        .returning();

    return {
        id: result.id,
        name: result.name,
        url: result.url,
        enabled: result.enabled,
        order: result.order,
        showCatalogs: result.showCatalogs,
    };
}

/**
 * Remove an addon
 */
export async function removeAddon(addonId: string) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const validatedId = z.string().min(1, "Addon ID is required").parse(addonId);
    await db.delete(addons).where(and(eq(addons.id, validatedId), eq(addons.userId, session.user.id)));

    return { success: true };
}

/**
 * Toggle addon enabled status
 */
export async function toggleAddon(addonId: string, enabled: boolean) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const validatedId = z.string().min(1, "Addon ID is required").parse(addonId);
    const validatedEnabled = z.boolean({ message: "Enabled must be a boolean" }).parse(enabled);

    await db
        .update(addons)
        .set({ enabled: validatedEnabled })
        .where(and(eq(addons.id, validatedId), eq(addons.userId, session.user.id)));

    return { success: true };
}

/**
 * Toggle addon catalog visibility on the dashboard
 */
export async function toggleAddonCatalogs(addonId: string, showCatalogs: boolean) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const validatedId = z.string().min(1, "Addon ID is required").parse(addonId);
    const validatedShow = z.boolean({ message: "showCatalogs must be a boolean" }).parse(showCatalogs);

    await db
        .update(addons)
        .set({ showCatalogs: validatedShow })
        .where(and(eq(addons.id, validatedId), eq(addons.userId, session.user.id)));

    return { success: true };
}

/**
 * Update addon orders (for reordering).
 * Uses a single batched UPDATE with CASE WHEN to avoid N individual queries.
 * Previous approach: 2N sequential queries to work around unique constraint.
 * New approach: Single raw SQL update — no constraint issues because it's atomic.
 */
export async function updateAddonOrders(updates: { id: string; order: number }[]) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const validated = addonOrderUpdateSchema.parse(updates);

    if (validated.length === 0) {
        return { success: true };
    }

    // Build a single UPDATE with CASE WHEN for all updates
    const ids = validated.map((u) => u.id);
    const caseClauses = validated.map((u) => sql`WHEN ${addons.id} = ${u.id} THEN ${u.order}`);

    await db
        .update(addons)
        .set({
            order: sql`CASE ${sql.join(caseClauses, sql` `)} END`,
        })
        .where(and(eq(addons.userId, session.user.id), inArray(addons.id, ids)));

    return { success: true };
}
