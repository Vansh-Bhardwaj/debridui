import { afterEach, describe, expect, test } from "bun:test";
import TorBoxClient, { mapTorBoxUsenetItem, type TorBoxUsenetDownload } from "../lib/clients/torbox";
import { AccountType, type User } from "../lib/types";

const item: TorBoxUsenetDownload = {
    id: 7, name: "Example", hash: "abc", size: 100, created_at: "2026-01-01T00:00:00Z", progress: 0.42,
    download_state: "downloading", download_speed: 10, active: true, cached: false,
    download_finished: false, download_present: false,
    files: [{ id: 3, name: "Example/video.mkv", short_name: "video.mkv", size: 100 }],
};
const client = () => new TorBoxClient({ apiKey: "test", type: AccountType.TORBOX } as User);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const respond = (data: unknown) => Response.json({ success: true, data });

describe("TorBox usenet mapping and routing", () => {
    test("namespaces parent and file IDs to prevent torrent collisions", () => {
        const file = mapTorBoxUsenetItem(item);
        expect(file.id).toBe("usenet:7");
        expect(file.files?.[0].id).toBe("usenet:7:3");
        expect(file.files?.[0].name).toBe("video.mkv");
        expect(file.progress).toBe(42);
        expect(file.status).toBe("downloading");
        expect(mapTorBoxUsenetItem({ ...item, download_finished: true, download_present: true }).status).toBe("completed");
        expect(mapTorBoxUsenetItem({ ...item, download_state: "queued" }).status).toBe("waiting");
        expect(mapTorBoxUsenetItem({ ...item, download_state: "failed" }).status).toBe("failed");
    });
    test("creates NZB links and files with the documented multipart fields", async () => {
        const inputs: FormData[] = [];
        globalThis.fetch = (async (_url, options) => {
            inputs.push(options?.body as FormData);
            return respond({ usenetdownload_id: 7, hash: "abc" });
        }) as typeof fetch;
        const api = client();
        await api.createUsenetDownload("https://example.com/get?id=7");
        await api.createUsenetDownload(new File(["nzb"], "example.nzb"));
        expect(inputs[0].get("link")).toBe("https://example.com/get?id=7");
        expect(inputs[0].has("file")).toBe(false);
        expect((inputs[1].get("file") as File).name).toBe("example.nzb");
        expect(inputs[1].has("link")).toBe(false);
    });
    test("requests and deletes through usenet endpoints", async () => {
        const calls: { url: string; body?: BodyInit | null }[] = [];
        globalThis.fetch = (async (url, options) => {
            calls.push({ url: decodeURIComponent(String(url)), body: options?.body });
            return respond("https://example.com/video");
        }) as typeof fetch;
        const api = client();
        const result = await api.getDownloadLink({ fileNode: mapTorBoxUsenetItem(item).files![0] });
        await api.removeTorrent("usenet:7");
        expect(result.link).toBe("https://example.com/video");
        expect(calls[0].url).toContain("usenet/requestdl");
        expect(calls[0].url).toContain("usenet_id=7&file_id=3");
        expect(calls[1].url).toContain("stream/createstream?id=7&file_id=3&type=usenet");
        expect(calls[2].url).toContain("usenet/controlusenetdownload");
        expect(JSON.parse(calls[2].body as string)).toEqual({ usenet_id: 7, operation: "delete" });
    });
    test("merges libraries before paging, with a real lookahead", async () => {
        globalThis.fetch = (async (url) => respond(decodeURIComponent(String(url)).includes("usenet/mylist") ? [item] : [])) as typeof fetch;
        const api = client();
        const page = await api.getTorrentList({ limit: 1 });
        expect(page.files[0].id).toBe("usenet:7");
        expect(page.hasMore).toBe(false);
        expect((await api.getTorrentList({ offset: 1, limit: 1 })).files).toHaveLength(0);
    });
    test("a restricted usenet plan still lists torrents", async () => {
        globalThis.fetch = (async (url) => decodeURIComponent(String(url)).includes("usenet/mylist")
            ? Response.json({ success: false, error: "PLAN_RESTRICTED_FEATURE", detail: "Pro only" }, { status: 403 })
            : respond([{ ...item, id: 7, seeds: 0, peers: 0, upload_speed: 0 }])) as typeof fetch;
        const page = await client().getTorrentList({ limit: 20 });
        expect(page.files[0].id).toBe("7");
        expect(page.hasMore).toBe(false);
    });
    test("a network error is not silently presented as an empty library", async () => {
        globalThis.fetch = (async () => { throw new Error("Network unavailable"); }) as typeof fetch;
        await expect(client().getTorrentList()).rejects.toThrow("Network unavailable");
    });

});
