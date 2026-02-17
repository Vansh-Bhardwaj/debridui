import { AccountType, DebridFileStatus, WebDownloadStatus } from "@/lib/types";
import {
    DownloadIcon,
    PauseIcon,
    InfoIcon,
    StoreIcon,
    UploadIcon,
    CircleCheckIcon,
    ClockIcon,
    OctagonAlertIcon,
    CircleXIcon,
    Zap,
} from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

export function AccountIcon({ type }: { type: AccountType | string }) {
    switch (type) {
        case AccountType.ALLDEBRID:
            return <StoreIcon />;
    }
}

// Unified color palette for status indicators
// Semantic colors with background, border, and text in one definition
const statusStyles = {
    slate: "bg-muted/40 border-border/50 text-muted-foreground",
    blue: "bg-primary/10 border-primary/30 text-primary",
    emerald: "bg-secondary/15 border-secondary/35 text-secondary",
    amber: "bg-accent/40 border-border/50 text-foreground/80",
    green: "bg-secondary/15 border-secondary/35 text-secondary",
    sky: "bg-primary/10 border-primary/30 text-primary",
    red: "bg-destructive/10 border-destructive/30 text-destructive",
    violet: "bg-accent/40 border-border/50 text-foreground/80",
    gray: "bg-muted/40 border-border/50 text-muted-foreground",
} as const;

type StatusColor = keyof typeof statusStyles;

interface StatusConfig {
    icon: typeof ClockIcon;
    color: StatusColor;
    name: string;
}

const statusConfig: Record<DebridFileStatus, StatusConfig> = {
    waiting: { icon: ClockIcon, color: "slate", name: "Waiting" },
    downloading: { icon: DownloadIcon, color: "blue", name: "Downloading" },
    seeding: { icon: UploadIcon, color: "emerald", name: "Seeding" },
    paused: { icon: PauseIcon, color: "amber", name: "Paused" },
    completed: { icon: CircleCheckIcon, color: "green", name: "Completed" },
    uploading: { icon: UploadIcon, color: "sky", name: "Uploading" },
    failed: { icon: OctagonAlertIcon, color: "red", name: "Failed" },
    processing: { icon: ClockIcon, color: "violet", name: "Processing" },
    inactive: { icon: CircleXIcon, color: "gray", name: "Inactive" },
    unknown: { icon: InfoIcon, color: "slate", name: "Unknown" },
};

export const StatusBadge = memo(function StatusBadge({
    status,
    hide,
}: {
    status: DebridFileStatus;
    hide?: DebridFileStatus;
}) {
    const config = statusConfig[status];
    if (!config) return null;
    if (hide && status === hide) return null;

    const Icon = config.icon;

    return (
        <span
            className={cn(
                "inline-flex items-center justify-center gap-1.5 h-6 px-2 border rounded-sm text-xs font-medium shrink-0",
                statusStyles[config.color]
            )}>
            <Icon className="size-3.5 shrink-0" strokeWidth={2.5} />
            <span className="hidden sm:inline tracking-wide">{config.name}</span>
        </span>
    );
});

export const CachedBadge = memo(function CachedBadge() {
    return (
        <span className="inline-flex items-center gap-1 text-xs tracking-wide text-primary">
            <Zap className="size-3" />
            <span>Cached</span>
        </span>
    );
});

interface WebStatusConfig {
    icon: typeof ClockIcon;
    label: string;
    color: StatusColor;
}

const webDownloadStatusConfig: Record<WebDownloadStatus, WebStatusConfig> = {
    pending: { icon: ClockIcon, label: "Pending", color: "slate" },
    processing: { icon: DownloadIcon, label: "Processing", color: "blue" },
    completed: { icon: CircleCheckIcon, label: "Ready", color: "green" },
    cached: { icon: Zap, label: "Cached", color: "emerald" },
    failed: { icon: OctagonAlertIcon, label: "Failed", color: "red" },
};

export const WebDownloadStatusBadge = memo(function WebDownloadStatusBadge({
    status,
    className,
}: {
    status: WebDownloadStatus;
    className?: string;
}) {
    const config = webDownloadStatusConfig[status];
    const Icon = config.icon;

    return (
        <span
            className={cn(
                "inline-flex items-center justify-center gap-1.5 h-6 px-2 border rounded-sm text-xs font-medium shrink-0",
                statusStyles[config.color],
                className
            )}>
            <Icon className="size-3.5 shrink-0" strokeWidth={2.5} />
            <span className="hidden sm:inline tracking-wide">{config.label}</span>
        </span>
    );
});
