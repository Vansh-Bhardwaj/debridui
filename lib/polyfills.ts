if (typeof (globalThis as any).__name === "undefined") {
    (globalThis as any).__name = <T extends (...args: any[]) => any>(fn: T, name: string): T => {
        Object.defineProperty(fn, "name", { value: name, configurable: true });
        return fn;
    };
}
