"use server";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, user } from "@/lib/db/schema";
import { getActor, profileOwnership, setProfileCookie } from "@/lib/auth/actor";
import { createProfileSchema, profileIdSchema, updateProfileSchema } from "@/lib/schemas";

export async function listProfiles() {
    const { userId, profileId } = await getActor();
    const items = await db.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(asc(profiles.createdAt), asc(profiles.id));
    return { profiles: items, activeProfileId: profileId };
}

export async function createProfile(name: string, avatar?: string | null, color?: string | null) {
    const { userId } = await getActor();
    const values = createProfileSchema.parse({ name, avatar, color });
    const [profile] = await db.insert(profiles).values({ userId, ...values }).returning();
    return profile;
}

export async function updateProfile(id: string, input: { name?: string; avatar?: string | null; color?: string | null }) {
    const { userId } = await getActor();
    const profileId = profileIdSchema.parse(id);
    const values = updateProfileSchema.parse(input);
    const [profile] = await db.update(profiles).set({ ...values, updatedAt: new Date() })
        .where(and(eq(profiles.userId, userId), eq(profiles.id, profileId))).returning();
    if (!profile) throw new Error("Profile not found");
    return profile;
}

export async function deleteProfile(id: string) {
    const { userId, profileId: activeId } = await getActor();
    const profileId = profileIdSchema.parse(id);
    const remaining = await db.transaction(async (tx) => {
        await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
        const items = await tx.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(asc(profiles.createdAt), asc(profiles.id));
        if (!items.some((p) => p.id === profileId)) throw new Error("Profile not found");
        if (items.length <= 1) throw new Error("Cannot delete the last profile");
        await tx.delete(profiles).where(and(eq(profiles.userId, userId), eq(profiles.id, profileId)));
        return items.find((p) => p.id !== profileId)!;
    });
    profileOwnership.invalidate(userId, profileId);
    if (activeId === profileId) await setProfileCookie(userId, remaining.id);
    return { success: true };
}

export async function setActiveProfile(id: string) {
    const { userId } = await getActor();
    const profileId = profileIdSchema.parse(id);
    await setProfileCookie(userId, profileId);
    return { success: true, profileId };
}
