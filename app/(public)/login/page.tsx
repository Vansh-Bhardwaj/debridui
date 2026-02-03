import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

// Prevent caching to ensure fresh session check after logout
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LoginPage() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if (session) {
        redirect("/dashboard");
    }

    return <LoginForm />;
}
