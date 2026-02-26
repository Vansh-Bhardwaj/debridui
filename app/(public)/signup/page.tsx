"use client";
export const dynamic = "force-static";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import SignupForm from "./signup-form";

export default function SignupPage() {
    const router = useRouter();
    const { data: session, isPending } = authClient.useSession();

    useEffect(() => {
        if (!isPending && session) {
            router.replace("/dashboard");
        }
    }, [session, isPending, router]);

    if (isPending || session) return null;

    return <SignupForm />;
}
