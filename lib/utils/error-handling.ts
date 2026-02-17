import { toast } from "sonner";

let lastUnauthorizedNoticeAt = 0;

/**
 * Lightweight error message extraction
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "An unexpected error occurred";
}

/**
 * Show error toast with optional fallback
 */
export function handleError(error: unknown, fallback?: string): void {
    toast.error(fallback || getErrorMessage(error));
}

/**
 * Handles unauthorized API responses in a consistent, user-safe way.
 */
export function handleUnauthorizedResponse(
    response: Response,
    options?: { redirect?: boolean; toastMessage?: string }
): boolean {
    if (response.status !== 401) return false;
    if (typeof window === "undefined") return true;

    const now = Date.now();
    if (now - lastUnauthorizedNoticeAt > 5000) {
        toast.error(options?.toastMessage ?? "Session expired. Please sign in again.");
        lastUnauthorizedNoticeAt = now;
    }

    if (options?.redirect !== false) {
        const path = window.location.pathname;
        if (!path.startsWith("/login") && !path.startsWith("/signup")) {
            setTimeout(() => {
                window.location.assign("/login");
            }, 150);
        }
    }

    return true;
}

/**
 * Fetch wrapper with a bounded timeout to avoid hanging UI paths.
 */
export async function fetchWithTimeout(
    input: RequestInfo | URL,
    init?: RequestInit,
    timeoutMs: number = 10000
): Promise<Response> {
    if (init?.signal) {
        return fetch(input, init);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}
