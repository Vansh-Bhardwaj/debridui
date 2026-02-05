"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { addons } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { type Addon } from "@/lib/addons/types";

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
export async function addAddon(addon: Omit<Addon, "id" | "order">) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const newId = uuidv7();

    // Single INSERT with subquery for order — saves 1 DB query vs SELECT MAX + INSERT
    const [result] = await db
        .insert(addons)
        .values({
            id: newId,
            userId: session.user.id,
            name: addon.name,
            url: addon.url,
            enabled: addon.enabled,
            order: sql`(SELECT COALESCE(MAX(${addons.order}), -1) + 1 FROM ${addons} WHERE ${addons.userId} = ${session.user.id})`,
        })
        .returning();

    revalidatePath("/", "layout");

    return {
        id: result.id,
        name: result.name,
        url: result.url,
        enabled: result.enabled,
        order: result.order,
    } satisfies Addon;
}

/**
 * Remove an addon
 */
export async function removeAddon(addonId: string) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    await db.delete(addons).where(and(eq(addons.id, addonId), eq(addons.userId, session.user.id)));

    revalidatePath("/", "layout");
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

    await db
        .update(addons)
        .set({ enabled })
        .where(and(eq(addons.id, addonId), eq(addons.userId, session.user.id)));

    revalidatePath("/", "layout");
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

    if (updates.length === 0) {
        revalidatePath("/", "layout");
        return { success: true };
    }

    // Build a single UPDATE with CASE WHEN for all updates
    const ids = updates.map((u) => u.id);
    const caseClauses = updates.map((u) => sql`WHEN ${addons.id} = ${u.id} THEN ${u.order}`);

    await db
        .update(addons)
        .set({
            order: sql`CASE ${sql.join(caseClauses, sql` `)} END`,
        })
        .where(and(eq(addons.userId, session.user.id), inArray(addons.id, ids)));

    revalidatePath("/", "layout");
    return { success: true };
}
