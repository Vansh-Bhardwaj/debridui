"use client";
export const dynamic = "force-static";

import { useState, Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle } from "lucide-react";

const resetPasswordSchema = z
    .object({
        password: z.string().min(8, "Password must be at least 8 characters"),
        confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
    });

function ResetPasswordForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");
    const [isSuccess, setIsSuccess] = useState(false);

    const form = useForm<z.infer<typeof resetPasswordSchema>>({
        resolver: zodResolver(resetPasswordSchema),
        defaultValues: { password: "", confirmPassword: "" },
    });

    async function onSubmit(values: z.infer<typeof resetPasswordSchema>) {
        if (!token) {
            toast.error("Invalid reset link");
            return;
        }

        try {
            const { error } = await authClient.resetPassword({
                newPassword: values.password,
                token,
            });

            if (error) {
                toast.error(error.message || "Failed to reset password");
                return;
            }

            setIsSuccess(true);
            toast.success("Password reset successfully");
        } catch {
            toast.error("An unexpected error occurred");
        }
    }

    if (!token) {
        return (
            <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
                <div className="w-full max-w-sm text-center">
                    <h1 className="text-xl font-light mb-2">Invalid Reset Link</h1>
                    <p className="text-sm text-muted-foreground mb-6">
                        This password reset link is invalid or has expired.
                    </p>
                    <Link href="/forgot-password">
                        <Button className="w-full">Request New Link</Button>
                    </Link>
                </div>
            </div>
        );
    }

    if (isSuccess) {
        return (
            <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
                <div className="w-full max-w-sm text-center">
                    <div className="flex flex-col items-center gap-4 mb-6">
                        <div className="size-12 rounded-full bg-green-500/10 flex items-center justify-center">
                            <CheckCircle className="size-6 text-green-500" />
                        </div>
                        <h1 className="text-xl font-light">Password Reset</h1>
                        <p className="text-sm text-muted-foreground">
                            Your password has been reset successfully.
                        </p>
                    </div>
                    <Button className="w-full" onClick={() => router.push("/login")}>
                        Sign In
                    </Button>
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
                    <h1 className="text-xl font-light">Reset Password</h1>
                    <p className="text-sm text-muted-foreground text-center">Enter your new password</p>
                </div>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>New Password</FormLabel>
                                    <FormControl>
                                        <Input type="password" placeholder="Enter new password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="confirmPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Confirm Password</FormLabel>
                                    <FormControl>
                                        <Input type="password" placeholder="Confirm new password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? "Resetting..." : "Reset Password"}
                        </Button>
                    </form>
                </Form>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div className="flex min-h-svh items-center justify-center">Loading...</div>}>
            <ResetPasswordForm />
        </Suspense>
    );
}
