/**
 * BrowseHandler — responds to remote browse requests from other devices.
 *
 * When a controller device requests a file list or search, this component
 * executes the debrid API call using the auth context and sends the response
 * back via the device sync WebSocket.
 *
 * Must be rendered inside an AuthProvider (private routes only).
 */

"use client";

import { useEffect } from "react";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import type { BrowseRequest, BrowseFileItem, BrowseResponse } from "@/lib/device-sync/protocol";

export function BrowseHandler() {
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const { client } = useAuthGuaranteed();

    useEffect(() => {
        if (!enabled) return;

        const handler = async (e: Event) => {
            const { fromId, request } = (e as CustomEvent<{ fromId: string; request: BrowseRequest }>).detail;

            let response: BrowseResponse;
            try {
                if (request.action === "list-files") {
                    const result = await client.getTorrentList({
                        offset: request.offset ?? 0,
                        limit: request.limit ?? 20,
                    });
                    const files: BrowseFileItem[] = result.files.map((f) => ({
                        id: f.id,
                        name: f.name,
                        size: f.size,
                        status: f.status,
                        progress: f.progress,
                        createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
                    }));
                    response = {
                        requestId: request.requestId,
                        files,
                        total: result.total,
                        hasMore: result.hasMore,
                    };
                } else if (request.action === "search") {
                    const results = await client.findTorrents(request.query ?? "");
                    const files: BrowseFileItem[] = results.map((f) => ({
                        id: f.id,
                        name: f.name,
                        size: f.size,
                        status: f.status,
                        progress: f.progress,
                        createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
                    }));
                    response = {
                        requestId: request.requestId,
                        files,
                    };
                } else {
                    response = { requestId: request.requestId, files: [], error: "Unknown action" };
                }
            } catch (err) {
                response = {
                    requestId: request.requestId,
                    files: [],
                    error: err instanceof Error ? err.message : "Failed to browse",
                };
            }

            // Send response back to the requesting device
            useDeviceSyncStore.getState()._sendBrowseResponse(fromId, response);
        };

        window.addEventListener("device-sync-browse", handler);
        return () => window.removeEventListener("device-sync-browse", handler);
    }, [enabled, client]);

    return null;
}
