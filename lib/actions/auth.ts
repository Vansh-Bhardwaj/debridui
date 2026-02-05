"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";

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

    // Single upsert — avoids SELECT + conditional INSERT (saves 1 DB query)
    await db
        .insert(user)
        .values({
            id,
            name: name || email.split("@")[0],
            email,
            image,
        })
        .onConflictDoNothing({ target: user.id });

    return { success: true };
}
