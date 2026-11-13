import { expect, spyOn, test } from "bun:test";
import { TraktClient } from "../lib/trakt";

test("reset clears tokens and an old 401 never refreshes the next profile", async () => {
    const client = new TraktClient({ clientId: "test" });
    client.setAccessToken("first");
    let respond!: (response: Response) => void;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => { started = resolve; });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
        started();
        return new Promise<Response>((resolve) => { respond = resolve; });
    });
    let refreshCalls = 0;
    try {
        const pending = client.getWatchlist();
        await requested;
        client.reset();
        expect(client.getAccessToken()).toBeUndefined();
        client.setAccessToken("second");
        client.setRefreshHandler(async () => { refreshCalls++; return "second-refreshed"; });
        respond(new Response(null, { status: 401 }));
        await expect(pending).rejects.toThrow("401");
        expect(refreshCalls).toBe(0);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(client.getAccessToken()).toBe("second");
    } finally { fetchSpy.mockRestore(); }
});

test("a pending token refresh cannot restore the old profile after reset", async () => {
    const client = new TraktClient({ clientId: "test" });
    client.setAccessToken("first", 1);
    let finishRefresh!: (token: string) => void;
    client.setRefreshHandler(() => new Promise<string>((resolve) => { finishRefresh = resolve; }));
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
        const pending = client.getWatchlist();
        client.reset();
        client.setAccessToken("second");
        finishRefresh("old-refreshed");
        await expect(pending).rejects.toThrow("Profile changed");
        expect(client.getAccessToken()).toBe("second");
        expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
});

test("an old successful response cannot trigger follow-up actions after switching", async () => {
    const client = new TraktClient({ clientId: "test" });
    client.setAccessToken("first");
    let finishParsing!: (data: unknown[]) => void;
    let started!: () => void;
    const parsing = new Promise<void>((resolve) => { started = resolve; });
    const response = Response.json([]);
    spyOn(response, "json").mockImplementation(() => {
        started();
        return new Promise<unknown[]>((resolve) => { finishParsing = resolve; });
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
        const pending = client.getWatchlist();
        await parsing;
        client.reset();
        client.setAccessToken("second");
        finishParsing([]);
        await expect(pending).rejects.toThrow("Profile changed");
        expect(client.getAccessToken()).toBe("second");
    } finally { fetchSpy.mockRestore(); }
});
