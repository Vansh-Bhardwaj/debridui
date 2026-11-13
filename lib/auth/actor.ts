import { cache } from "react";
import { cookies } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles, user } from "@/lib/db/schema";
import { getRequiredEnv } from "@/lib/env";
import { OwnershipCache, signProfile, verifyProfile } from "./profile-cookie";

export class UnauthorizedError extends Error {
    constructor() { super("Unauthorized"); }
}
export const profileOwnership = new OwnershipCache();

export async function ownsProfile(userId: string, profileId: string) {
    if (profileOwnership.has(userId, profileId)) return true;
    const [profile] = await db.select({ id: profiles.id }).from(profiles)
        .where(and(eq(profiles.userId, userId), eq(profiles.id, profileId))).limit(1);
    if (profile) profileOwnership.add(userId, profileId);
    return !!profile;
}

const getSessionUser = cache(async () => {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) throw new UnauthorizedError();
    return session.user;
});

/** Account-level identity (debrid accounts, addons, signing): no profile lookup. */
export const getAccount = cache(async () => ({ userId: (await getSessionUser()).id }));

export const getActor = cache(async (): Promise<{ userId: string; profileId: string }> => {
    const sessionUser = await getSessionUser();
    const userId = sessionUser.id;
    const cookie = (await cookies()).get("dui-profile")?.value;
    const profileId = await verifyProfile(cookie, userId, getRequiredEnv("NEON_AUTH_COOKIE_SECRET"));
    if (profileId && await ownsProfile(userId, profileId)) return { userId, profileId };

    let [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId))
        .orderBy(asc(profiles.createdAt), asc(profiles.id)).limit(1);
    if (!profile) {
        profile = await db.transaction(async (tx) => {
            await tx.insert(user).values({ id: userId, name: sessionUser.name || "Default", email: sessionUser.email, image: sessionUser.image }).onConflictDoNothing({ target: user.id });
            // Lock the parent row to serialize first-profile creation and profile deletion.
            await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
            const [existing] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(asc(profiles.createdAt), asc(profiles.id)).limit(1);
            if (existing) return existing;
            const [created] = await tx.insert(profiles).values({ userId, name: "Default" }).returning();
            return created;
        });
    }
    profileOwnership.add(userId, profile.id);
    return { userId, profileId: profile.id };
});

export async function setProfileCookie(userId: string, profileId: string) {
    if (!await ownsProfile(userId, profileId)) throw new Error("Profile not found");
    (await cookies()).set("dui-profile", await signProfile(userId, profileId, getRequiredEnv("NEON_AUTH_COOKIE_SECRET")), {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    });
}
