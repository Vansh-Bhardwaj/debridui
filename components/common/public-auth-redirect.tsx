"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const REDIRECT_ROUTES = new Set([
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
]);

/**
 * Redirect authenticated users away from auth-entry public pages.
 * Keeps utility public pages (e.g. pair/status) accessible.
 */
export function PublicAuthRedirect() {
    const router = useRouter();
    const pathname = usePathname();
    const { data: session } = authClient.useSession();

    useEffect(() => {
        if (!session?.user) return;
        if (!REDIRECT_ROUTES.has(pathname)) return;
        router.replace("/dashboard");
    }, [session, pathname, router]);

    return null;
}
