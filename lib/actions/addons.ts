"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { addons } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
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
 * Add a new addon
 */
export async function addAddon(addon: Omit<Addon, "id" | "order">) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    // Calculate next order atomically
    const [maxOrder] = await db
        .select({ max: sql<number>`COALESCE(MAX(${addons.order}), -1)` })
        .from(addons)
        .where(eq(addons.userId, session.user.id));

    const newOrder = (maxOrder?.max ?? -1) + 1;
    const newId = uuidv7();

    await db.insert(addons).values({
        id: newId,
        userId: session.user.id,
        name: addon.name,
        url: addon.url,
        enabled: addon.enabled,
        order: newOrder,
    });

    revalidatePath("/", "layout");

    return {
        id: newId,
        name: addon.name,
        url: addon.url,
        enabled: addon.enabled,
        order: newOrder,
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
 * Neon HTTP driver has no transaction support, so we use a two-phase update to avoid
 * unique (userId, order) constraint violations: move to temp negative orders, then to final.
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

    // Phase 1: set each row to a temporary unique order (negative) to avoid constraint conflicts
    for (let i = 0; i < updates.length; i++) {
        await db
            .update(addons)
            .set({ order: -1 - i })
            .where(and(eq(addons.id, updates[i].id), eq(addons.userId, session.user.id)));
    }
    // Phase 2: set final orders
    for (const u of updates) {
        await db
            .update(addons)
            .set({ order: u.order })
            .where(and(eq(addons.id, u.id), eq(addons.userId, session.user.id)));
    }

    revalidatePath("/", "layout");
    return { success: true };
}
