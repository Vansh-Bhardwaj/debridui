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

    let validated;
    try {
        validated = createAccountSchema.parse(data);
    } catch {
        throw new Error("Invalid account data: type and API key are required");
    }
    const userId = session.user.id;

    try {
        // Check if account already exists (SELECT works reliably via Hyperdrive cache)
        const existing = await db
            .select({ id: userAccounts.id })
            .from(userAccounts)
            .where(
                and(
                    eq(userAccounts.userId, userId),
                    eq(userAccounts.apiKey, validated.apiKey),
                    eq(userAccounts.type, validated.type)
                )
            );

        if (existing.length > 0) {
            // Update name for existing account
            const [account] = await db
                .update(userAccounts)
                .set({ name: validated.name })
                .where(eq(userAccounts.id, existing[0].id))
                .returning();
            return account;
        }

        // Insert new account
        const [account] = await db
            .insert(userAccounts)
            .values({
                id: uuidv7(),
                userId,
                apiKey: validated.apiKey,
                type: validated.type,
                name: validated.name,
                createdAt: new Date(),
            })
            .returning();

        return account;
    } catch (error) {
        // Log full postgres error details (code, detail, constraint)
        const pgErr = error as { code?: string; detail?: string; constraint_name?: string; severity?: string; where?: string };
        console.error("[addUserAccount] Database error:", {
            message: error instanceof Error ? error.message : String(error),
            code: pgErr.code,
            detail: pgErr.detail,
            constraint: pgErr.constraint_name,
            severity: pgErr.severity,
            where: pgErr.where,
        });
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("timeout")) {
            throw new Error("Database connection failed — please try again");
        }
        if (msg.includes("duplicate") || msg.includes("unique") || pgErr.code === "23505") {
            throw new Error("This account is already connected");
        }
        if (msg.includes("foreign key") || msg.includes("violates") || pgErr.code === "23503") {
            throw new Error("User session expired — please log in again");
        }
        throw new Error(`Failed to save account: ${msg.slice(0, 200)}`);
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
