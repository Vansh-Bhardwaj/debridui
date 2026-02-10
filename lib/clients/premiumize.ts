import {
    User,
    DebridFile,
    DebridFileStatus,
    DebridNode,
    DebridFileNode,
    DebridLinkInfo,
    DebridFileList,
    DebridFileAddStatus,
    OperationResult,
    AccountType,
    DebridAuthError,
    DebridError,
    DebridRateLimitError,
    WebDownloadList,
    WebDownloadStatus,
} from "@/lib/types";
import BaseClient from "./base";
import { USER_AGENT } from "../constants";
import { getProxyUrl } from "@/lib/utils";
import type { WebDownloadAddResult } from "@/lib/types";

// Premiumize API Response types
interface PremiumizeApiResponse {
    status: "success" | "error";
    message?: string;
}

interface PremiumizeAccountInfo extends PremiumizeApiResponse {
    customer_id: number;
    premium_until: number;
    limit_used: number;
    space_used: number;
}

type PremiumizeTransferStatus =
    | "waiting"
    | "finished"
    | "running"
    | "deleted"
    | "banned"
    | "error"
    | "timeout"
    | "seeding"
    | "queued";

interface PremiumizeTransfer {
    id: string;
    name: string;
    status: PremiumizeTransferStatus;
    progress: number;
    src?: string;
    folder_id?: string;
    file_id?: string;
    message?: string;
}

interface PremiumizeTransferListResponse extends PremiumizeApiResponse {
    transfers: PremiumizeTransfer[];
}

interface PremiumizeItem {
    id: string;
    name: string;
    type: "file" | "folder";
    size?: number;
    created_at?: number;
    mime_type?: string;
    link?: string;
    stream_link?: string;
    virus_scan?: "ok" | "infected" | "error";
    transcode_status?: string;
}

interface PremiumizeFolderListResponse extends PremiumizeApiResponse {
    content: PremiumizeItem[];
    name?: string;
    parent_id?: string;
    folder_id?: string;
    breadcrumbs?: { id: string; name: string; parent_id: string }[];
}

interface PremiumizeItemListAllFile {
    id: string;
    name: string;
    created_at: number;
    size: number;
    mime_type?: string;
    virus_scan?: "ok" | "infected" | "error";
    path: string;
}

interface PremiumizeItemListAllResponse extends PremiumizeApiResponse {
    files: PremiumizeItemListAllFile[];
}

interface PremiumizeItemDetails extends PremiumizeApiResponse {
    id: string;
    name: string;
    type: string;
    size: number;
    created_at: number;
    folder_id?: string;
    link?: string;
    stream_link?: string;
    mime_type?: string;
    transcode_status?: string;
    virus_scan?: string;
}

interface PremiumizeTransferCreateResponse extends PremiumizeApiResponse {
    id?: string;
    name?: string;
    type?: string;
}

interface PremiumizeDirectDlContent {
    path: string;
    size: number;
    link: string;
    stream_link?: string;
    transcode_status?: string;
}

interface PremiumizeDirectDlResponse extends PremiumizeApiResponse {
    location?: string;
    filename?: string;
    filesize?: number;
    content?: PremiumizeDirectDlContent[];
}

interface PremiumizeCacheCheckResponse extends PremiumizeApiResponse {
    response: boolean[];
    transcoded: boolean[];
    filename: string[];
    filesize: string[];
}

export default class PremiumizeClient extends BaseClient {
    readonly refreshInterval: number | false = false;
    readonly supportsEphemeralLinks: boolean = false;

    constructor(user: User) {
        super({ user });
    }

    private static buildUrl(path: string, apiKey: string): string {
        const separator = path.includes("?") ? "&" : "?";
        return getProxyUrl(
            `https://www.premiumize.me/api${path}${separator}apikey=${encodeURIComponent(apiKey)}`,
        );
    }

    private async makeRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
        await this.rateLimiter.acquire();
        const { apiKey } = this.user;

        const response = await fetch(PremiumizeClient.buildUrl(path, apiKey), {
            ...options,
            headers: {
                "User-Agent": USER_AGENT,
                ...options.headers,
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new DebridAuthError("Invalid or expired API key", AccountType.PREMIUMIZE);
            }
            if (response.status === 429) {
                const retryAfter = response.headers.get("Retry-After");
                throw new DebridRateLimitError(
                    "Rate limit exceeded",
                    AccountType.PREMIUMIZE,
                    retryAfter ? parseInt(retryAfter) : undefined,
                );
            }
            throw new DebridError(`API request failed: ${response.statusText}`, AccountType.PREMIUMIZE);
        }

        const data: PremiumizeApiResponse & Record<string, unknown> = await response.json();

        if (data.status === "error") {
            const errorMessage = data.message || "Unknown error";
            if (
                errorMessage.toLowerCase().includes("auth") ||
                errorMessage.toLowerCase().includes("apikey") ||
                errorMessage.toLowerCase().includes("token")
            ) {
                throw new DebridAuthError(errorMessage, AccountType.PREMIUMIZE);
            }
            throw new DebridError(errorMessage, AccountType.PREMIUMIZE);
        }

        return data as T;
    }

    static async getUser(apiKey: string): Promise<User> {
        const response = await fetch(PremiumizeClient.buildUrl("/account/info", apiKey), {
            headers: { "User-Agent": USER_AGENT },
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new DebridAuthError("Invalid or expired API key", AccountType.PREMIUMIZE);
            }
            throw new DebridError(`Failed to get user info: ${response.statusText}`, AccountType.PREMIUMIZE);
        }

        const data: PremiumizeAccountInfo = await response.json();

        if (data.status === "error") {
            throw new DebridError(data.message || "Failed to get user information", AccountType.PREMIUMIZE);
        }

        const premiumExpiry = data.premium_until ? new Date(data.premium_until * 1000) : new Date();
        const isPremium = premiumExpiry > new Date();

        return {
            id: `${AccountType.PREMIUMIZE}:${data.customer_id}`,
            apiKey,
            type: AccountType.PREMIUMIZE,
            name: `${data.customer_id}`,
            email: "",
            language: "en",
            isPremium,
            premiumExpiresAt: premiumExpiry,
        };
    }

    static async getAuthPin(): Promise<{
        pin: string;
        check: string;
        redirect_url: string;
    }> {
        // Premiumize uses direct API key auth — redirect to account page
        return {
            pin: "PREMIUMIZE_API_KEY",
            check: "direct_api_key",
            redirect_url: "https://www.premiumize.me/account",
        };
    }

    static async validateAuthPin(
        pin: string,
        check: string,
    ): Promise<{ success: boolean; apiKey?: string }> {
        if (check === "direct_api_key") {
            try {
                await this.getUser(pin);
                return { success: true, apiKey: pin };
            } catch {
                return { success: false };
            }
        }
        return { success: false };
    }

    async getTorrentList({
        offset = 0,
        limit = 20,
    }: {
        offset?: number;
        limit?: number;
    } = {}): Promise<DebridFileList> {
        const [transfersResponse, itemsResponse] = await Promise.all([
            this.makeRequest<PremiumizeTransferListResponse>("/transfer/list"),
            this.makeRequest<PremiumizeItemListAllResponse>("/item/listall"),
        ]);

        const files: DebridFile[] = [];

        // Active transfers (downloading, queued, etc.)
        const activeTransfers = (transfersResponse.transfers || []).filter(
            (t) => t.status !== "finished" && t.status !== "deleted",
        );
        for (const transfer of activeTransfers) {
            files.push(this.mapTransferToDebridFile(transfer));
        }

        // All files from cloud storage
        for (const file of itemsResponse.files || []) {
            files.push(this.mapListAllFileToDebridFile(file));
        }

        const paginatedFiles = files.slice(offset, offset + limit);
        return {
            files: paginatedFiles,
            offset,
            limit,
            hasMore: offset + limit < files.length,
            total: files.length,
        };
    }

    async findTorrents(searchQuery: string): Promise<DebridFile[]> {
        if (!searchQuery.trim()) {
            return (await this.getTorrentList({ limit: 100 })).files;
        }

        const response = await this.makeRequest<PremiumizeFolderListResponse>(
            `/folder/search?q=${encodeURIComponent(searchQuery)}`,
        );

        return (response.content || [])
            .filter((item) => item.type === "file")
            .map((item) => this.mapItemToDebridFile(item));
    }

    async findTorrentById(torrentId: string): Promise<DebridFile | null> {
        try {
            const transfersResponse =
                await this.makeRequest<PremiumizeTransferListResponse>("/transfer/list");
            const transfer = transfersResponse.transfers?.find((t) => t.id === torrentId);
            if (transfer) return this.mapTransferToDebridFile(transfer);

            const itemResponse = await this.makeRequest<PremiumizeItemDetails>(
                `/item/details?id=${torrentId}`,
            );
            return this.mapItemDetailsToDebridFile(itemResponse);
        } catch {
            return null;
        }
    }

    async getDownloadLink({
        fileNode,
    }: {
        fileNode: DebridFileNode;
        resolve?: boolean;
    }): Promise<DebridLinkInfo> {
        // Try to get item details for a download link
        try {
            const itemResponse = await this.makeRequest<PremiumizeItemDetails>(
                `/item/details?id=${fileNode.id}`,
            );
            if (itemResponse.link) {
                return {
                    link: itemResponse.link,
                    name: itemResponse.name || fileNode.name,
                    size: itemResponse.size || fileNode.size || 0,
                };
            }
        } catch {
            // Fall through to directdl
        }

        // Fall back to directdl for magnets or external links
        if (fileNode.id.startsWith("magnet:") || fileNode.id.startsWith("http")) {
            const formData = new URLSearchParams();
            formData.append("src", fileNode.id);

            const response = await this.makeRequest<PremiumizeDirectDlResponse>("/transfer/directdl", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData,
            });

            if (response.content && response.content.length > 0) {
                const firstFile = response.content[0];
                return {
                    link: firstFile.link,
                    name: firstFile.path.split("/").pop() || fileNode.name,
                    size: firstFile.size || fileNode.size || 0,
                };
            }

            if (response.location) {
                return {
                    link: response.location,
                    name: response.filename || fileNode.name,
                    size: response.filesize || fileNode.size || 0,
                };
            }
        }

        throw new DebridError("Could not get download link for this file", AccountType.PREMIUMIZE);
    }

    async getStreamingLinks(_id: string, fileNode?: DebridFileNode): Promise<Record<string, string>> {
        // Premiumize provides stream_link on items — try to resolve it
        if (fileNode) {
            try {
                const itemResponse = await this.makeRequest<PremiumizeItemDetails>(
                    `/item/details?id=${fileNode.id}`,
                );
                if (itemResponse.stream_link) {
                    return { original: itemResponse.stream_link };
                }
                if (itemResponse.link) {
                    return { original: itemResponse.link };
                }
            } catch {
                // No streaming links available
            }
        }
        return {};
    }

    async getTorrentFiles(torrentId: string): Promise<DebridNode[]> {
        // Check if this is a transfer ID
        try {
            const transfersResponse =
                await this.makeRequest<PremiumizeTransferListResponse>("/transfer/list");
            const transfer = transfersResponse.transfers?.find((t) => t.id === torrentId);

            if (transfer) {
                if (transfer.folder_id) {
                    const folderResponse = await this.makeRequest<PremiumizeFolderListResponse>(
                        `/folder/list?id=${transfer.folder_id}`,
                    );
                    return this.convertItemsToNodes(folderResponse.content || []);
                }
                if (transfer.file_id) {
                    const itemResponse = await this.makeRequest<PremiumizeItemDetails>(
                        `/item/details?id=${transfer.file_id}`,
                    );
                    return [
                        {
                            id: itemResponse.id,
                            name: itemResponse.name,
                            size: itemResponse.size,
                            type: "file" as const,
                            children: [],
                        },
                    ];
                }
                return [];
            }
        } catch {
            // Not a transfer, continue
        }

        // Try as folder
        try {
            const folderResponse = await this.makeRequest<PremiumizeFolderListResponse>(
                `/folder/list?id=${torrentId}`,
            );
            return this.convertItemsToNodes(folderResponse.content || []);
        } catch {
            // Try as single item
            try {
                const itemResponse = await this.makeRequest<PremiumizeItemDetails>(
                    `/item/details?id=${torrentId}`,
                );
                return [
                    {
                        id: itemResponse.id,
                        name: itemResponse.name,
                        size: itemResponse.size,
                        type: "file" as const,
                        children: [],
                    },
                ];
            } catch {
                return [];
            }
        }
    }

    async removeTorrent(torrentId: string): Promise<string> {
        const formData = new URLSearchParams();
        formData.append("id", torrentId);

        try {
            await this.makeRequest<PremiumizeApiResponse>("/transfer/delete", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData,
            });
            return "Transfer removed successfully";
        } catch {
            await this.makeRequest<PremiumizeApiResponse>("/item/delete", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData,
            });
            return "Item removed successfully";
        }
    }

    async restartTorrents(torrentIds: string[]): Promise<Record<string, OperationResult>> {
        return torrentIds.reduce(
            (acc, id) => {
                acc[id] = { success: false, message: "Premiumize does not support restarting transfers" };
                return acc;
            },
            {} as Record<string, OperationResult>,
        );
    }

    async addMagnetLinks(magnetUris: string[]): Promise<Record<string, DebridFileAddStatus>> {
        const results = await Promise.allSettled(
            magnetUris.map(async (magnet) => {
                const formData = new FormData();
                formData.append("src", magnet);

                const response = await this.makeRequest<PremiumizeTransferCreateResponse>(
                    "/transfer/create",
                    { method: "POST", body: formData },
                );

                return {
                    magnet,
                    status: {
                        id: response.id,
                        success: true,
                        message: response.name ? `Added: ${response.name}` : "Torrent added successfully",
                        is_cached: response.type === "cached",
                    } as DebridFileAddStatus,
                };
            }),
        );

        return magnetUris.reduce(
            (acc, magnet, index) => {
                const result = results[index];
                acc[magnet] =
                    result.status === "fulfilled"
                        ? result.value.status
                        : {
                              success: false,
                              message: result.reason?.message || `Failed to add torrent`,
                              is_cached: false,
                          };
                return acc;
            },
            {} as Record<string, DebridFileAddStatus>,
        );
    }

    async uploadTorrentFiles(files: File[]): Promise<Record<string, DebridFileAddStatus>> {
        const results = await Promise.allSettled(
            files.map(async (file) => {
                const formData = new FormData();
                formData.append("file", file);

                const response = await this.makeRequest<PremiumizeTransferCreateResponse>(
                    "/transfer/create",
                    { method: "POST", body: formData },
                );

                return {
                    fileName: file.name,
                    status: {
                        id: response.id,
                        success: true,
                        message: response.name ? `Added: ${response.name}` : "Torrent added successfully",
                        is_cached: response.type === "cached",
                    } as DebridFileAddStatus,
                };
            }),
        );

        return files.reduce(
            (acc, file, index) => {
                const result = results[index];
                acc[file.name] =
                    result.status === "fulfilled"
                        ? result.value.status
                        : {
                              success: false,
                              message: result.reason?.message || `Failed to add torrent`,
                              is_cached: false,
                          };
                return acc;
            },
            {} as Record<string, DebridFileAddStatus>,
        );
    }

    /** Check if items (magnets, links) are cached on Premiumize */
    async checkCache(items: string[]): Promise<{ cached: boolean; filename: string; filesize: string }[]> {
        const params = new URLSearchParams();
        items.forEach((item) => params.append("items[]", item));

        const response = await this.makeRequest<PremiumizeCacheCheckResponse>(
            `/cache/check?${params.toString()}`,
        );

        return items.map((_, index) => ({
            cached: response.response?.[index] || false,
            filename: response.filename?.[index] || "",
            filesize: response.filesize?.[index] || "0",
        }));
    }

    // Web download methods
    async addWebDownloads(links: string[]): Promise<WebDownloadAddResult[]> {
        const results: WebDownloadAddResult[] = [];

        for (const link of links) {
            try {
                const formData = new FormData();
                formData.append("src", link);

                const response = await this.makeRequest<PremiumizeTransferCreateResponse>(
                    "/transfer/create",
                    { method: "POST", body: formData },
                );

                results.push({ link, success: true, id: response.id, name: response.name || link });
            } catch (error) {
                results.push({
                    link,
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                });
            }
        }

        return results;
    }

    async getWebDownloadList({ offset, limit }: { offset: number; limit: number }): Promise<WebDownloadList> {
        const response = await this.makeRequest<PremiumizeTransferListResponse>("/transfer/list");

        const httpTransfers = (response.transfers || []).filter(
            (t) => t.src && t.src.startsWith("http") && !t.src.startsWith("magnet:"),
        );

        const total = httpTransfers.length;
        const paginated = httpTransfers.slice(offset, offset + limit);

        // Fetch download links for finished transfers
        const finishedWithFileId = paginated.filter(
            (t) => (t.status === "finished" || t.status === "seeding") && t.file_id,
        );
        const downloadLinks = new Map<string, string>();

        if (finishedWithFileId.length > 0) {
            await Promise.all(
                finishedWithFileId.map(async (t) => {
                    try {
                        const itemResponse = await this.makeRequest<PremiumizeItemDetails>(
                            `/item/details?id=${t.file_id}`,
                        );
                        if (itemResponse.link) downloadLinks.set(t.id, itemResponse.link);
                    } catch {
                        // Ignore individual item errors
                    }
                }),
            );
        }

        return {
            downloads: paginated.map((t) => ({
                id: t.id,
                name: t.name,
                originalLink: t.src || "",
                status: this.mapTransferToWebDownloadStatus(t.status),
                progress: (t.progress || 0) * 100,
                createdAt: new Date(),
                error: t.message && t.status === "error" ? t.message : undefined,
                downloadLink: downloadLinks.get(t.id),
            })),
            offset,
            limit,
            hasMore: offset + limit < total,
            total,
        };
    }

    async deleteWebDownload(id: string): Promise<void> {
        const formData = new URLSearchParams();
        formData.append("id", id);

        await this.makeRequest<PremiumizeApiResponse>("/transfer/delete", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData,
        });
    }

    // Private helpers
    private mapTransferToDebridFile(transfer: PremiumizeTransfer): DebridFile {
        const status = this.mapTransferStatus(transfer.status);
        return {
            id: transfer.id,
            name: transfer.name,
            size: 0,
            status,
            progress: (transfer.progress || 0) * 100,
            createdAt: new Date(),
            error: transfer.message && status === "failed" ? transfer.message : undefined,
            files: undefined,
        };
    }

    private mapItemToDebridFile(item: PremiumizeItem): DebridFile {
        return {
            id: item.id,
            name: item.name,
            size: item.size || 0,
            status: "completed",
            progress: 100,
            createdAt: item.created_at ? new Date(item.created_at * 1000) : new Date(),
            completedAt: item.created_at ? new Date(item.created_at * 1000) : undefined,
            files:
                item.link || item.stream_link
                    ? [{ id: item.id, name: item.name, size: item.size, type: "file" as const, children: [] }]
                    : undefined,
        };
    }

    private mapItemDetailsToDebridFile(item: PremiumizeItemDetails): DebridFile {
        return {
            id: item.id,
            name: item.name,
            size: item.size || 0,
            status: "completed",
            progress: 100,
            createdAt: item.created_at ? new Date(item.created_at * 1000) : new Date(),
            completedAt: item.created_at ? new Date(item.created_at * 1000) : undefined,
            files: [{ id: item.id, name: item.name, size: item.size, type: "file" as const, children: [] }],
        };
    }

    private mapListAllFileToDebridFile(file: PremiumizeItemListAllFile): DebridFile {
        const displayName = file.path || file.name;
        return {
            id: file.id,
            name: displayName,
            size: file.size || 0,
            status: "completed",
            progress: 100,
            createdAt: file.created_at ? new Date(file.created_at * 1000) : new Date(),
            completedAt: file.created_at ? new Date(file.created_at * 1000) : undefined,
            files: [{ id: file.id, name: file.name, size: file.size, type: "file" as const, children: [] }],
        };
    }

    private mapTransferStatus(status: PremiumizeTransferStatus): DebridFileStatus {
        const statusMap: Record<PremiumizeTransferStatus, DebridFileStatus> = {
            waiting: "waiting",
            queued: "waiting",
            running: "downloading",
            seeding: "seeding",
            finished: "completed",
            error: "failed",
            banned: "failed",
            timeout: "failed",
            deleted: "inactive",
        };
        return statusMap[status] || "unknown";
    }

    private mapTransferToWebDownloadStatus(status: PremiumizeTransferStatus): WebDownloadStatus {
        const statusMap: Record<PremiumizeTransferStatus, WebDownloadStatus> = {
            waiting: "pending",
            queued: "pending",
            running: "processing",
            seeding: "completed",
            finished: "completed",
            error: "failed",
            banned: "failed",
            timeout: "failed",
            deleted: "failed",
        };
        return statusMap[status] || "pending";
    }

    private convertItemsToNodes(items: PremiumizeItem[]): DebridNode[] {
        return items.map((item): DebridNode => {
            if (item.type === "folder") {
                return { name: item.name, size: undefined, type: "folder", children: [] };
            }
            return { id: item.id, name: item.name, size: item.size, type: "file", children: [] };
        });
    }
}
