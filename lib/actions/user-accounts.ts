"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { createAccountSchema } from "@/lib/schemas";
import { type CreateAccount } from "@/lib/types";
import { v7 as uuidv7 } from "uuid";

/**
 * Get all user accounts for the current authenticated user
 * Note: Returns apiKey because client-side debrid API calls require it
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
 */
export async function addUserAccount(data: CreateAccount) {
    const { data: session } = await auth.getSession();

    if (!session) {
        redirect("/login");
    }

    const validated = createAccountSchema.parse(data);
    const userId = session.user.id;

    try {
        // Single upsert — avoids SELECT + conditional INSERT (saves 1 DB query)
        // Uses unique_user_account constraint on (userId, apiKey, type)
        const [account] = await db
            .insert(userAccounts)
            .values({
                id: uuidv7(),
                userId,
                apiKey: validated.apiKey,
                type: validated.type,
                name: validated.name,
            })
            .onConflictDoUpdate({
                target: [userAccounts.userId, userAccounts.apiKey, userAccounts.type],
                set: { name: validated.name },
            })
            .returning();

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

    const validatedId = z.string().min(1, "Account ID is required").parse(accountId);

    // Single DELETE with ownership check — avoids redundant SELECT (saves 1 DB query)
    const deleted = await db
        .delete(userAccounts)
        .where(and(eq(userAccounts.id, validatedId), eq(userAccounts.userId, session.user.id)))
        .returning({ id: userAccounts.id });

    if (deleted.length === 0) {
        throw new Error("Account not found or unauthorized");
    }

    return { success: true };
}
