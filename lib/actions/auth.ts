"use server";

import { getAccount, UnauthorizedError } from "@/lib/auth/actor";

export async function syncUser() {
    try {
        await getAccount();
        return { success: true };
    } catch (error) {
        if (error instanceof UnauthorizedError) return { success: false, error: "Not authenticated" };
        throw error;
    }
}
