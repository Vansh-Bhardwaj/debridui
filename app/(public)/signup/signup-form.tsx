"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { DISABLE_EMAIL_SIGNUP, NEON_AUTH_URL } from "@/lib/constants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";

const signupSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export default function SignupForm() {
    const router = useRouter();
    const [isVerifying, setIsVerifying] = useState(false);
    const [emailForVerification, setEmailForVerification] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

    // Use values directly to be extremely safe against module scope issues
    const isGoogleOAuthEnabled = !!(process.env.NEXT_PUBLIC_NEON_AUTH_URL || NEON_AUTH_URL);
    const isEmailSignupDisabled = (process.env.NEXT_PUBLIC_DISABLE_EMAIL_SIGNUP || DISABLE_EMAIL_SIGNUP) === "true";

    const form = useForm<z.infer<typeof signupSchema>>({
        resolver: zodResolver(signupSchema),
        defaultValues: {
            name: "",
            email: "",
            password: "",
        },
    });

    async function onSubmit(values: z.infer<typeof signupSchema>) {
        try {
            const { data, error } = await authClient.signUp.email({
                email: values.email,
                password: values.password,
                name: values.name,
            });

            if (error) {
                toast.error(error.message || "Failed to sign up");
                return;
            }

            if (data) {
                setEmailForVerification(values.email);
                setIsVerifying(true);
                toast.success("Verification code sent to your email");
            }
        } catch {
            toast.error("An unexpected error occurred");
        }
    }

    async function handleVerifyOtp() {
        if (otpCode.length !== 6) {
            toast.error("Please enter a valid 6-digit code");
            return;
        }

        setIsVerifyingOtp(true);
        try {
            const { error } = await authClient.emailOtp.verifyEmail({
                email: emailForVerification,
                otp: otpCode,
            });

            if (error) {
                toast.error(error.message || "Invalid or expired code");
            } else {
                toast.success("Email verified successfully");
                router.push("/onboarding");
            }
        } catch (err) {
            console.error("Verification error:", err);
            toast.error("Failed to verify code");
        } finally {
            setIsVerifyingOtp(false);
        }
    }

    const isDisabled = form.formState.isSubmitting || isVerifyingOtp;

    if (isVerifying) {
        return (
            <div className="bg-background grid grid-rows-[1fr_auto] min-h-svh p-6 md:p-10">
                <div className="flex items-center justify-center">
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
                                <span className="sr-only">DebridUI</span>
                            </Link>
                            <h1 className="text-xl font-light">Verify Your Email</h1>
                            <p className="text-sm text-muted-foreground text-center">
                                We sent a 6-digit code to <span className="font-medium text-foreground">{emailForVerification}</span>
                            </p>
                        </div>

                        <div className="flex flex-col gap-4">
                            <div className="space-y-2">
                                <Label>Verification Code</Label>
                                <Input
                                    type="text"
                                    placeholder="000000"
                                    maxLength={6}
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ""))}
                                    className="text-center text-2xl tracking-[0.5em] font-mono h-12"
                                />
                            </div>
                            <Button className="w-full" onClick={handleVerifyOtp} disabled={isVerifyingOtp}>
                                {isVerifyingOtp ? "Verifying..." : "Verify Email"}
                            </Button>
                            <Button
                                variant="ghost"
                                className="w-full text-xs"
                                onClick={() => setIsVerifying(false)}
                                disabled={isVerifyingOtp}>
                                Back to Sign Up
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-background grid grid-rows-[1fr_auto] min-h-svh p-6 md:p-10">
            <div className="flex items-center justify-center">
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
                            <span className="sr-only">DebridUI</span>
                        </Link>
                        <h1 className="text-xl font-light">Create an Account</h1>
                        <p className="text-sm text-muted-foreground text-center">Sign up to get started</p>
                    </div>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
                            <GoogleSignInButton callbackURL="/dashboard" disabled={isDisabled} />

                            {isGoogleOAuthEnabled && !isEmailSignupDisabled && (
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <Separator />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-background px-2 text-muted-foreground">
                                            Or continue with email
                                        </span>
                                    </div>
                                </div>
                            )}

                            {!isEmailSignupDisabled && (
                                <div className="flex flex-col gap-6">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Your name" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

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

                                    <FormField
                                        control={form.control}
                                        name="password"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Password</FormLabel>
                                                <FormControl>
                                                    <Input type="password" placeholder="Create a password" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <Button type="submit" className="w-full" disabled={isDisabled}>
                                        {isDisabled ? "Creating account..." : "Sign Up"}
                                    </Button>
                                </div>
                            )}
                            {isEmailSignupDisabled && !isGoogleOAuthEnabled && (
                                <Alert variant="destructive">
                                    <AlertTitle>New signup is disabled</AlertTitle>
                                    <AlertDescription>
                                        New signup is disabled. Please contact the administrator to create an account.
                                    </AlertDescription>
                                </Alert>
                            )}
                            <div className="text-center text-sm">
                                Already have an account?{" "}
                                <Link href="/login" className="underline underline-offset-4 hover:text-primary">
                                    Sign in
                                </Link>
                            </div>
                        </form>
                    </Form>
                </div>
            </div>

            <footer className="flex items-center justify-center pb-6">
                <div className="text-muted-foreground *:[a]:hover:text-primary text-center text-xs text-balance *:[a]:underline *:[a]:underline-offset-4">
                    By signing up, you acknowledge our{" "}
                    <a
                        href="https://github.com/Vansh-Bhardwaj/debridui/blob/main/DISCLAIMER.md"
                        target="_blank"
                        rel="noopener noreferrer">
                        disclaimer
                    </a>
                    .
                </div>
            </footer>
        </div>
    );
}
