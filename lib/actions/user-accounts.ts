"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { AccountType } from "@/lib/schemas";
import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";

/**
 * Get all user accounts for the current authenticated user
 * `server-serialization` - Returns minimal data (no sensitive info in client bundle)
 */
export async function getUserAccounts() {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    // `async-defer-await` - Single query, await immediately
    const accounts = await db.select().from(userAccounts).where(eq(userAccounts.userId, session.user.id));

    return accounts;
}

/**
 * Add a new user account
 * Note: Validation is done on the frontend before calling this
 */
export async function addUserAccount(data: { apiKey: string; type: AccountType; name: string }) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const { apiKey, type, name } = data;
    const userId = session.user.id;

    // Check if account already exists
    const existing = await db
        .select()
        .from(userAccounts)
        .where(
            and(
                eq(userAccounts.userId, userId),
                eq(userAccounts.apiKey, apiKey),
                eq(userAccounts.type, type)
            )
        );

    if (existing.length > 0) {
        return existing[0];
    }

    try {
        // Add account to database
        const [account] = await db
            .insert(userAccounts)
            .values({
                id: uuidv7(),
                userId,
                apiKey,
                type,
                name,
            })
            .returning();

        revalidatePath("/", "layout");
        return account;
    } catch (error) {
        console.error("[addUserAccount] Database error:", error);
        throw error;
    }
}

/**
 * Remove a user account (only if owned by current user)
 */
export async function removeUserAccount(accountId: string) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    // Verify ownership before deletion
    const account = await db
        .select()
        .from(userAccounts)
        .where(and(eq(userAccounts.id, accountId), eq(userAccounts.userId, session.user.id)));

    if (account.length === 0) {
        throw new Error("Account not found or unauthorized");
    }

    await db.delete(userAccounts).where(eq(userAccounts.id, accountId));

    revalidatePath("/", "layout");
    return { success: true };
}
