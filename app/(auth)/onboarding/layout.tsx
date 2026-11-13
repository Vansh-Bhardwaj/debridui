import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { getAccount, UnauthorizedError } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { userAccounts } from "@/lib/db/schema";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
    const actor = await getAccount().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });

    if (!actor) {
        redirect("/login");
    }

    const [{ total }] = await db
        .select({ total: count() })
        .from(userAccounts)
        .where(eq(userAccounts.userId, actor.userId));

    if (total > 0) {
        redirect("/dashboard");
    }

    return children;
}
