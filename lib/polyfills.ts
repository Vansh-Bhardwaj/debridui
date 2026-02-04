type NamePolyfill = <T extends (...args: unknown[]) => unknown>(fn: T, name: string) => T;
const g = globalThis as typeof globalThis & { __name?: NamePolyfill };
if (typeof g.__name === "undefined") {
    g.__name = <T extends (...args: unknown[]) => unknown>(fn: T, name: string): T => {
        Object.defineProperty(fn, "name", { value: name, configurable: true });
        return fn;
    };
}
