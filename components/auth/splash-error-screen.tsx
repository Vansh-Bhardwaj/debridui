import { AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DISCORD_URL } from "@/lib/constants";

interface SplashErrorScreenProps {
    title?: string;
    error?: Error | null;
    onRetry?: () => void;
    onDelete?: () => void;
    onLogout?: () => void;
}

export function SplashErrorScreen({
    title = "Connection Error",
    error,
    onRetry,
    onDelete,
    onLogout,
}: SplashErrorScreenProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 text-center p-6 max-w-sm">
                <AlertCircle className="size-10 text-destructive" strokeWidth={1.5} />
                <div className="space-y-2">
                    <h1 className="text-xl font-light">{title}</h1>
                    <p className="text-sm text-muted-foreground">{error?.message || "Failed to load your account"}</p>
                </div>
                <div className="flex gap-3">
                    {onRetry && <Button onClick={onRetry}>Try Again</Button>}
                    {onDelete && (
                        <Button variant="destructive" onClick={onDelete}>
                            Remove Account
                        </Button>
                    )}
                    {onLogout && (
                        <Button variant="outline" onClick={onLogout}>
                            Logout
                        </Button>
                    )}
                </div>
                {DISCORD_URL && (
                    <a
                        href={DISCORD_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Need help? Join Discord
                        <ExternalLink className="size-3" />
                    </a>
                )}
            </div>
        </div>
    );
}
