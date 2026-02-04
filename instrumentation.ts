// Polyfill __name IMMEDIATELY at module evaluation (before any imports)
// Required for better-auth's Rolldown bundler in Cloudflare Workers
type NamePolyfill = <T extends (...args: unknown[]) => unknown>(fn: T, name: string) => T;
const g = globalThis as typeof globalThis & { __name?: NamePolyfill };
if (typeof g.__name === "undefined") {
    g.__name = <T extends (...args: unknown[]) => unknown>(fn: T, name: string): T => {
        Object.defineProperty(fn, "name", { value: name, configurable: true });
        return fn;
    };
}

export async function register() {
    // Runtime initialization logging (polyfill already applied above)
}
