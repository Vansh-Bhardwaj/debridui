import { traktClient } from "./lib/trakt";

async function run() {
    console.log("Searching TMDB ID 799882");
    try {
        const res = await traktClient.searchByTmdbId("799882", "movie");
        console.log("Result:", JSON.stringify(res, null, 2));
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
