import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
    icon?: LucideIcon;
    title: string;
    description: string;
    action?: React.ReactNode;
    divider?: boolean;
}

export function PageHeader({ icon: Icon, title, description, action, divider = false }: PageHeaderProps) {
    return (
        <div
            className={cn(
                "animate-in fade-in-0 slide-in-from-bottom-1 duration-500 ease-premium motion-reduce:animate-none",
                divider && "space-y-10"
            )}
            data-tv-section>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        {Icon && <Icon className="size-6 sm:size-7 text-primary" strokeWidth={1.5} />}
                        <h1 className="text-2xl sm:text-3xl font-light">{title}</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </div>
            {divider && <div className="h-px bg-border/50" />}
        </div>
    );
}
