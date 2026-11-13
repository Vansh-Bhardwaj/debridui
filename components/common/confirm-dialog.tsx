"use client";

import { Loader2 } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIsMobile } from "@/hooks/use-mobile";

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    isConfirming?: boolean;
    variant?: "destructive" | "default";
}

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    onConfirm,
    isConfirming = false,
    variant = "default",
}: ConfirmDialogProps) {
    const isMobile = useIsMobile();

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent data-tv-section size={isMobile ? "sm" : "default"}>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel data-tv-focusable disabled={isConfirming}>{cancelText}</AlertDialogCancel>
                    <AlertDialogAction data-tv-focusable
                        onClick={onConfirm}
                        disabled={isConfirming}
                        variant={variant === "destructive" ? "destructive" : "default"}>
                        {isConfirming ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                Working...
                            </>
                        ) : (
                            confirmText
                        )}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
