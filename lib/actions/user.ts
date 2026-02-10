"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";

/**
 * Set password for users who don't have one (OAuth users)
 * Requires a fresh session token (user must have signed in recently)
 */
export async function setPassword(newPassword: string) {
    try {
        const validated = z.string().min(8, "Password must be at least 8 characters").parse(newPassword);

        const { error } = await auth.changePassword({
            newPassword: validated,
            currentPassword: "", // Better Auth allows empty currentPassword when setting for the first time
        });

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error("Error setting password:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to set password",
        };
    }
}
