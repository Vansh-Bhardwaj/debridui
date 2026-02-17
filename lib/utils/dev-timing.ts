type TimerMeta = Record<string, unknown>;

const isDev = process.env.NODE_ENV === "development";

function getNow(): number {
    if (typeof performance !== "undefined") return performance.now();
    return Date.now();
}

export function createDevTimer(label: string, meta?: TimerMeta) {
    if (!isDev) {
        return {
            step: (_name: string, _data?: TimerMeta) => {},
            end: (_data?: TimerMeta) => {},
        };
    }

    const startedAt = getNow();

    return {
        step(name: string, data?: TimerMeta) {
            const elapsedMs = Math.round((getNow() - startedAt) * 10) / 10;
            console.debug(`[timing] ${label}:${name}`, { elapsedMs, ...meta, ...data });
        },
        end(data?: TimerMeta) {
            const totalMs = Math.round((getNow() - startedAt) * 10) / 10;
            console.debug(`[timing] ${label}:end`, { totalMs, ...meta, ...data });
        },
    };
}
