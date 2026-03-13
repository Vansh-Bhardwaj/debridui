import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAccounts } from "@/lib/db/schema";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
    const { data: session } = await auth.getSession();

    if (!session?.user?.id) {
        redirect("/login");
    }

    const [{ total }] = await db
        .select({ total: count() })
        .from(userAccounts)
        .where(eq(userAccounts.userId, session.user.id));

    if (total > 0) {
        redirect("/dashboard");
    }

    return children;
}
