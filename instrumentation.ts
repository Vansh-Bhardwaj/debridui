// Polyfill __name IMMEDIATELY at module evaluation (before any imports)
// Required for better-auth's Rolldown bundler in Cloudflare Workers
if (typeof (globalThis as any).__name === "undefined") {
    (globalThis as any).__name = <T extends (...args: any[]) => any>(fn: T, name: string): T => {
        Object.defineProperty(fn, "name", { value: name, configurable: true });
        return fn;
    };
}

export async function register() {
    // Runtime initialization logging (polyfill already applied above)
}
