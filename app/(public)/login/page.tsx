"use client";
export const dynamic = "force-static";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import LoginForm from "./login-form";

export default function LoginPage() {
    const router = useRouter();
    const { data: session, isPending } = authClient.useSession();

    useEffect(() => {
        if (!isPending && session) {
            router.replace("/dashboard");
        }
    }, [session, isPending, router]);

    // Don't render form while checking session to avoid flash
    if (isPending || session) return null;

    return <LoginForm />;
}
