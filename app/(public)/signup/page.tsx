import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SignupForm from "./signup-form";

export default async function SignupPage() {
    const { data: session } = await auth.getSession();

    if (session) {
        redirect("/dashboard");
    }

    return <SignupForm />;
}
