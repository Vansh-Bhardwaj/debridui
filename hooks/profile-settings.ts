import { refreshTraktToken } from "@/lib/actions/settings";
import { traktClient } from "@/lib/trakt";
import type { ServerSettings } from "@/lib/types";
import { useSettingsStore } from "@/lib/stores/settings";

export function hydrateSettingsFromServer(settings: ServerSettings | null) {
    if (!settings) return;
    if (settings.tmdb_api_key !== undefined && useSettingsStore.getState().get("tmdbApiKey") !== settings.tmdb_api_key) useSettingsStore.getState().set("tmdbApiKey", settings.tmdb_api_key);
    traktClient.setAccessToken(settings.trakt_access_token ?? "", settings.trakt_expires_at);
    traktClient.setRefreshHandler(refreshTraktToken);
}
