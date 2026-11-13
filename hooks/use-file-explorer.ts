import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { useState, useMemo } from "react";
import { PAGE_SIZE } from "@/lib/constants";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { sortTorrentFiles } from "@/lib/utils/file";

export function useFileExplorer() {
    const { client, currentAccount } = useAuthGuaranteed();
    const searchParams = useSearchParams();
    const [pagination, setPagination] = useState({ accountId: currentAccount.id, page: 1 });
    const currentPage = pagination.accountId === currentAccount.id ? pagination.page : 1;

    const sortBy = searchParams.get("sort_by") || (typeof window !== "undefined" && localStorage.getItem("file-sort-by")) || "date";
    const sortOrder = (searchParams.get("sort_order") as "asc" | "desc") || (typeof window !== "undefined" && localStorage.getItem("file-sort-order") as "asc" | "desc") || "desc";

    // Calculate pagination values
    const offset = useMemo(() => (currentPage - 1) * PAGE_SIZE, [currentPage]);
    const limit = PAGE_SIZE;

    const { data, isLoading, isError, error, isFetching, isPlaceholderData, refetch } = useQuery({
        queryKey: [currentAccount.id, "getTorrentList", currentPage],
        queryFn: () => client.getTorrentList({ offset, limit }),
        placeholderData: (previous, query) => query?.queryKey[0] === currentAccount.id ? keepPreviousData(previous) : undefined,
        staleTime: 0, // Always revalidate on mount — refetchInterval manages freshness while mounted
        // Adaptive polling: fast when downloads are active, slow when idle
        // Saves ~80% Worker requests vs fixed 3s polling
        refetchInterval: (query) => {
            const files = query.state.data?.files;
            const hasActive = files?.some((f) => f.status === "downloading" || f.status === "waiting" || f.status === "processing");
            return hasActive ? (currentAccount.type === "torbox" ? 10000 : 5000) : 30000;
        },
        refetchIntervalInBackground: false, // Stop polling when tab is hidden
    });

    // Removing the last item or a provider's optimistic hasMore can leave an empty last page.
    if (data && !isPlaceholderData && !isFetching && currentPage > 1 && data.files.length === 0) {
        setPagination({ accountId: currentAccount.id, page: Math.max(1, currentPage - 1) });
    }

    // Calculate total pages from data
    const totalPages = useMemo(() => {
        if (!data) return 1;

        if (data.total !== undefined) {
            return Math.max(1, Math.ceil(data.total / PAGE_SIZE));
        }

        if (!data.hasMore) {
            return Math.max(1, Math.ceil((offset + data.files.length) / PAGE_SIZE));
        }

        return currentPage + 1;
    }, [data, offset, currentPage]);

    // Sort files locally
    const sortedFiles = useMemo(() => {
        if (!data?.files) return [];
        if (sortBy === "date" && sortOrder === "desc") return data.files;
        return sortTorrentFiles(data.files, sortBy, sortOrder);
    }, [data, sortBy, sortOrder]);

    const setPage = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setPagination({ accountId: currentAccount.id, page });
        }
    };

    return {
        files: sortedFiles,
        isLoading,
        isError,
        error,
        isFetching,
        isPlaceholderData,
        refetch,
        currentPage,
        totalPages,
        setPage,
        sortBy,
        sortOrder,
    };
}
