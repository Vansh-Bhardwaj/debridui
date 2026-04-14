"use client";
export const dynamic = "force-static";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import LoginForm from "./login-form";
import { SplashScreen } from "@/components/auth/splash-screen";

export default function LoginPage() {
    const router = useRouter();
    const { data: session, isPending } = authClient.useSession();

    useEffect(() => {
        if (!isPending && session) {
            router.replace("/dashboard");
        }
    }, [session, isPending, router]);

    useEffect(() => {
        if (!isPending && !session) {
            router.prefetch("/dashboard");
        }
    }, [isPending, session, router]);

    if (isPending || session) {
        return <SplashScreen stage={isPending ? "Checking session…" : "Redirecting…"} />;
    }

    return <LoginForm />;
}
