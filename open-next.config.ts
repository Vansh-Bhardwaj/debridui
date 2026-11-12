import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Free-plan CPU budget is 10ms. Almost every page is prerendered (force-static
// client shells), so serve them from Workers static assets (free, read-only)
// instead of re-rendering per request. Cache interception answers cache hits
// before the Next.js server is even loaded. No ISR/revalidation is used.
export default defineCloudflareConfig({
    incrementalCache: staticAssetsIncrementalCache,
    enableCacheInterception: true,
});
