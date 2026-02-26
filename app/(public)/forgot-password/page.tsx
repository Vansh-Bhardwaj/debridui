"use client";
export const dynamic = "force-static";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";

const forgotPasswordSchema = z.object({
    email: z.string().email("Invalid email address"),
});

export default function ForgotPasswordPage() {
    const [isSubmitted, setIsSubmitted] = useState(false);

    const form = useForm<z.infer<typeof forgotPasswordSchema>>({
        resolver: zodResolver(forgotPasswordSchema),
        defaultValues: { email: "" },
    });

    async function onSubmit(values: z.infer<typeof forgotPasswordSchema>) {
        try {
            const { error } = await authClient.requestPasswordReset({
                email: values.email,
                redirectTo: "/reset-password",
            });

            if (error) {
                toast.error(error.message || "Failed to send reset email");
                return;
            }

            setIsSubmitted(true);
            toast.success("Password reset email sent");
        } catch {
            toast.error("An unexpected error occurred");
        }
    }

    if (isSubmitted) {
        return (
            <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
                <div className="w-full max-w-sm text-center">
                    <div className="flex flex-col items-center gap-4 mb-6">
                        <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <Mail className="size-6 text-primary" />
                        </div>
                        <h1 className="text-xl font-light">Check your email</h1>
                        <p className="text-sm text-muted-foreground">
                            We&apos;ve sent a password reset link to{" "}
                            <span className="font-medium text-foreground">{form.getValues("email")}</span>
                        </p>
                    </div>
                    <Link href="/login">
                        <Button variant="outline" className="w-full">
                            <ArrowLeft className="size-4 mr-2" />
                            Back to login
                        </Button>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
            <div className="w-full max-w-sm">
                <div className="flex flex-col items-center gap-2 mb-6">
                    <Link href="/" className="flex flex-col items-center gap-2 font-medium">
                        <div className="flex size-12 items-center justify-center">
                            <Image
                                src="/icon.svg"
                                alt="DebridUI"
                                width={48}
                                height={48}
                                className="invert dark:invert-0"
                            />
                        </div>
                    </Link>
                    <h1 className="text-xl font-light">Forgot Password</h1>
                    <p className="text-sm text-muted-foreground text-center">
                        Enter your email and we&apos;ll send you a reset link
                    </p>
                </div>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input type="email" placeholder="name@example.com" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? "Sending..." : "Send Reset Link"}
                        </Button>

                        <div className="text-center text-sm">
                            <Link
                                href="/login"
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                                <ArrowLeft className="size-3" />
                                Back to login
                            </Link>
                        </div>
                    </form>
                </Form>
            </div>
        </div>
    );
}
