type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export function migrateProgressKeys(storage: StorageLike, firstProfileId: string) {
    if (storage.getItem("dui-progress-migrated")) return;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) {
        if (!key || !/^progress:tt\d+(?::s\d+e\d+)?$/.test(key)) continue;
        const target = `progress:${firstProfileId}:${key.slice(9)}`;
        const value = storage.getItem(key);
        if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
        storage.removeItem(key);
    }
    storage.setItem("dui-progress-migrated", firstProfileId);
}

export function progressStorageKey(profileId: string, key: { imdbId: string; type: string; season?: number; episode?: number }) {
    const suffix = key.type === "show" && key.season !== undefined && key.episode !== undefined ? `:s${key.season}e${key.episode}` : "";
    return `progress:${profileId}:${key.imdbId}${suffix}`;
}
