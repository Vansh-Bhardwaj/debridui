import { Loader2, Inbox, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface StateBaseProps {
    className?: string;
}

interface LoadingStateProps extends StateBaseProps {
    label?: string;
}

interface EmptyStateProps extends StateBaseProps {
    title: string;
    description?: string;
}

interface ErrorStateProps extends StateBaseProps {
    title?: string;
    description?: string;
}

export function LoadingState({ label = "Loading...", className }: LoadingStateProps) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 rounded-sm border border-border/50 bg-muted/30 px-4 py-10 text-center", className)}>
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <p className="text-xs tracking-wide uppercase text-muted-foreground">{label}</p>
        </div>
    );
}

export function EmptyState({ title, description, className }: EmptyStateProps) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 rounded-sm border border-border/50 bg-muted/30 px-4 py-10 text-center", className)}>
            <Inbox className="size-5 text-muted-foreground" />
            <p className="text-sm font-light text-foreground">{title}</p>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
    );
}

export function ErrorState({ title = "Something went wrong", description, className }: ErrorStateProps) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 rounded-sm border border-destructive/30 bg-destructive/5 px-4 py-10 text-center", className)}>
            <CircleAlert className="size-5 text-destructive" />
            <p className="text-sm font-light text-foreground">{title}</p>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
    );
}
