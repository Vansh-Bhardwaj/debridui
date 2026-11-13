"use server";

import { redirect } from "next/navigation";
import { getAccount, UnauthorizedError } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { addons } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { addonSchema, addonOrderUpdateSchema } from "@/lib/schemas";
import { type CreateAddon } from "@/lib/types";
import { v7 as uuidv7 } from "uuid";

/**
 * Get all user addons from database
 */
export async function getUserAddons() {
    const actor = await getAccount().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });

    if (!actor) {
        redirect("/login");
    }

    const userAddons = await db.select().from(addons).where(eq(addons.userId, actor.userId)).orderBy(addons.order);

    return userAddons;
}

/**
 * Add a new addon — single query using subquery for order calculation
 */
export async function addAddon(data: CreateAddon) {
    const actor = await getAccount().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });

    if (!actor) {
        redirect("/login");
    }

    const validated = addonSchema.parse(data);
    const newId = uuidv7();

    // Single INSERT with subquery for order — saves 1 DB query vs SELECT MAX + INSERT
    const [result] = await db
        .insert(addons)
        .values({
            id: newId,
            userId: actor.userId,
            name: validated.name,
            url: validated.url,
            enabled: validated.enabled,
            order: sql`(SELECT COALESCE(MAX(${addons.order}), -1) + 1 FROM ${addons} WHERE ${addons.userId} = ${actor.userId})`,
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
    const actor = await getAccount().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });

    if (!actor) {
        redirect("/login");
    }

    const validatedId = z.string().min(1, "Addon ID is required").parse(addonId);
    await db.delete(addons).where(and(eq(addons.id, validatedId), eq(addons.userId, actor.userId)));

    return { success: true };
}

/**
 * Toggle addon enabled status
 */
export async function toggleAddon(addonId: string, enabled: boolean) {
    const actor = await getAccount().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });

    if (!actor) {
        redirect("/login");
    }

    const validatedId = z.string().min(1, "Addon ID is required").parse(addonId);
    const validatedEnabled = z.boolean({ message: "Enabled must be a boolean" }).parse(enabled);

    await db
        .update(addons)
        .set({ enabled: validatedEnabled })
        .where(and(eq(addons.id, validatedId), eq(addons.userId, actor.userId)));

    return { success: true };
}

/**
 * Toggle addon catalog visibility on the dashboard
 */
export async function toggleAddonCatalogs(addonId: string, showCatalogs: boolean) {
    const actor = await getAccount().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });

    if (!actor) {
        redirect("/login");
    }

    const validatedId = z.string().min(1, "Addon ID is required").parse(addonId);
    const validatedShow = z.boolean({ message: "showCatalogs must be a boolean" }).parse(showCatalogs);

    await db
        .update(addons)
        .set({ showCatalogs: validatedShow })
        .where(and(eq(addons.id, validatedId), eq(addons.userId, actor.userId)));

    return { success: true };
}

/**
 * Update addon orders (for reordering).
 * Uses sequential single-row UPDATEs with a temp order to break the unique
 * constraint cycle. Works on Neon (no SET CONSTRAINTS / DEFERRABLE support
 * through their pooler).
 */
export async function updateAddonOrders(updates: { id: string; order: number }[]) {
    const actor = await getAccount().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });

    if (!actor) {
        redirect("/login");
    }

    const validated = addonOrderUpdateSchema.parse(updates);

    if (validated.length === 0) {
        return { success: true };
    }

    await db.transaction(async (tx) => {
        // Move first row to a temp order to free its slot
        await tx
            .update(addons)
            .set({ order: -2147483647 })
            .where(and(eq(addons.id, validated[0].id), eq(addons.userId, actor.userId)));

        // Assign final orders to remaining rows (the freed slot is now available)
        for (let i = 1; i < validated.length; i++) {
            await tx
                .update(addons)
                .set({ order: validated[i].order })
                .where(and(eq(addons.id, validated[i].id), eq(addons.userId, actor.userId)));
        }

        // Assign first row its final order
        await tx
            .update(addons)
            .set({ order: validated[0].order })
            .where(and(eq(addons.id, validated[0].id), eq(addons.userId, actor.userId)));
    });

    return { success: true };
}
