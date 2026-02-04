"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Syncs the current authenticated user from Neon Auth to our local database.
 * This ensures that foreign keys in other tables (like user_accounts) work correctly.
 */
export async function syncUser() {
    const { data: session } = await auth.getSession();

    if (!session) {
        return { success: false, error: "Not authenticated" };
    }

    const { id, name, email, image } = session.user;

    // Check if user already exists in our DB
    const existing = await db.select().from(user).where(eq(user.id, id));

    if (existing.length === 0) {
        // Create user in our DB
        await db.insert(user).values({
            id,
            name: name || email.split("@")[0],
            email,
            image,
        });
        console.log(`[auth] Synced new user: ${email} (${id})`);
    }

    return { success: true };
}
