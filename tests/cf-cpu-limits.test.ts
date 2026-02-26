/**
 * Cloudflare Workers Free Tier CPU Limit Safeguards
 *
 * These tests verify optimizations that keep the app within the 10ms CPU limit
 * on CF Workers free tier. They run after `next build` and inspect build output
 * + source code to catch regressions.
 *
 * Run: bun test tests/cf-cpu-limits.test.ts
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..");

// ── Helpers ──────────────────────────────────────────────────────

function readSource(relPath: string): string {
    return readFileSync(join(ROOT, relPath), "utf-8");
}

function sourceExists(relPath: string): boolean {
    return existsSync(join(ROOT, relPath));
}

/**
 * Read .next/routes-manifest.json to find statically generated routes.
 * Falls back gracefully if build output isn't present.
 */
function _getRoutesManifest(): { staticRoutes: { page: string }[]; dynamicRoutes: { page: string }[] } | null {
    const path = join(ROOT, ".next", "routes-manifest.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Read .next/prerender-manifest.json to find ISR/SSG routes.
 */
function getPrerenderManifest(): { routes: Record<string, unknown> } | null {
    const path = join(ROOT, ".next", "prerender-manifest.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
}

// ── Source-level checks (always run) ─────────────────────────────

describe("source: public routes must not use server-side auth", () => {
    const publicPages = [
        "app/(public)/page.tsx",
        "app/(public)/login/page.tsx",
        "app/(public)/signup/page.tsx",
        "app/(public)/forgot-password/page.tsx",
        "app/(public)/reset-password/page.tsx",
    ];

    for (const page of publicPages) {
        test(`${page} does not import server auth`, () => {
            if (!sourceExists(page)) return; // skip if page doesn't exist
            const src = readSource(page);
            // Server-side auth calls that consume CPU
            expect(src).not.toContain('from "@/lib/auth"');
            expect(src).not.toContain("auth.getSession()");
        });
    }
});

describe("source: landing page must be force-static", () => {
    test('app/(public)/page.tsx exports dynamic = "force-static"', () => {
        const src = readSource("app/(public)/page.tsx");
        expect(src).toContain('export const dynamic = "force-static"');
    });

    test("landing page is not an async server component", () => {
        const src = readSource("app/(public)/page.tsx");
        // Should not have `async function` for the default export
        expect(src).not.toMatch(/export\s+default\s+async\s+function/);
    });
});

describe("source: authenticated pages should be client components", () => {
    const authAppDir = join(ROOT, "app/(auth)/(app)");
    if (existsSync(authAppDir)) {
        const dirs = readdirSync(authAppDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

        for (const dir of dirs) {
            const pagePath = `app/(auth)/(app)/${dir}/page.tsx`;
            test(`${pagePath} is a client component or lightweight`, () => {
                if (!sourceExists(pagePath)) return;
                const src = readSource(pagePath);
                // Should either be "use client" or not use heavy server imports
                const isClient = src.includes('"use client"') || src.includes("'use client'");
                const usesServerAuth = src.includes("auth.getSession()");
                // Client components are fine; server components should not call auth
                if (!isClient) {
                    expect(usesServerAuth).toBe(false);
                }
            });
        }
    }
});

describe("source: API routes should stream when possible", () => {
    test("addon proxy streams response body", () => {
        const src = readSource("app/api/addon/proxy/route.ts");
        // Should use response.body (streaming) not response.text() (buffering)
        expect(src).toContain("response.body");
        expect(src).not.toMatch(/const\s+data\s*=\s*await\s+response\.text\(\)/);
    });
});

describe("source: subtitle routes have size limits", () => {
    const subtitleRoutes = [
        "app/api/subtitles/proxy/route.ts",
        "app/api/subtitles/vlc/[filename]/route.ts",
    ];

    for (const route of subtitleRoutes) {
        test(`${route} has file size limit`, () => {
            if (!sourceExists(route)) return;
            const src = readSource(route);
            // Should check content-length against a max size
            expect(src).toMatch(/content-length/i);
            expect(src).toContain("413");
        });
    }
});

describe("source: no dynamic Date() in static pages", () => {
    test("landing page does not use new Date().getFullYear()", () => {
        const src = readSource("app/(public)/page.tsx");
        expect(src).not.toContain("new Date()");
        expect(src).not.toContain("getFullYear()");
    });
});

describe("config: optimizePackageImports includes heavy packages", () => {
    test("next.config.ts has critical packages in optimizePackageImports", () => {
        const src = readSource("next.config.ts");
        const requiredPackages = ["lucide-react", "zod", "date-fns"];
        for (const pkg of requiredPackages) {
            expect(src).toContain(`"${pkg}"`);
        }
    });
});

describe("source: TV mode disabled on mobile", () => {
    test("useTVMode auto-disables on mobile", () => {
        const src = readSource("hooks/use-tv-mode.ts");
        expect(src).toContain("useIsMobile");
        expect(src).toContain("isMobile");
    });
});

// ── Build-output checks (only run after fresh `next build`) ──────

/** Check if build output is newer than a source file */
function isBuildFresh(): boolean {
    const buildIdPath = join(ROOT, ".next", "BUILD_ID");
    const pagePath = join(ROOT, "app", "(public)", "page.tsx");
    if (!existsSync(buildIdPath) || !existsSync(pagePath)) return false;
    return statSync(buildIdPath).mtimeMs >= statSync(pagePath).mtimeMs;
}

describe("build: static route verification", () => {
    const prerender = getPrerenderManifest();
    const buildFresh = isBuildFresh();

    // This test validates that `/` is statically pre-rendered after `next build`.
    // Skipped when build output is stale (source modified after last build).
    test.skipIf(!prerender || !buildFresh)("landing page (/) is in prerender manifest", () => {
        expect(prerender!.routes).toHaveProperty("/");
    });

    test("next.config.ts has /discover redirects configured", () => {
        const src = readSource("next.config.ts");
        expect(src).toContain('source: "/discover"');
        expect(src).toContain('source: "/discover/addon"');
        expect(src).toContain('destination: "/dashboard"');
    });
});

describe("build: worker bundle size", () => {
    const workerPath = join(ROOT, ".open-next", "worker.js");
    const workerExists = existsSync(workerPath);

    test.skipIf(!workerExists)("worker.js is under 10MB (parsing budget)", () => {
        const stats = Bun.file(workerPath);
        // 10MB is a reasonable upper bound — larger bundles risk exceeding
        // CPU limits just from initial JS parsing on cold starts
        expect(stats.size).toBeLessThan(10 * 1024 * 1024);
    });

    const handlerPath = join(ROOT, ".open-next", "server-functions", "default", "handler.mjs");
    const handlerExists = existsSync(handlerPath);

    test.skipIf(!handlerExists)("handler.mjs is under 5MB", () => {
        const stats = Bun.file(handlerPath);
        expect(stats.size).toBeLessThan(5 * 1024 * 1024);
    });
});
