"use server";

import { auth } from "@/lib/auth";

/**
 * Set password for users who don't have one (OAuth users)
 * Requires a fresh session token (user must have signed in recently)
 */
export async function setPassword(newPassword: string) {
    try {
        const { error } = await auth.changePassword({
            newPassword,
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
