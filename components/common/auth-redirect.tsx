"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

/** Redirects authenticated users to dashboard — used on the static landing page. */
export function AuthRedirect() {
    const router = useRouter();
    const { data: session } = authClient.useSession();

    useEffect(() => {
        if (session?.user) {
            router.replace("/dashboard");
        }
    }, [session, router]);

    return null;
}
