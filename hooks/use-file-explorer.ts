import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { useState, useMemo } from "react";
import { PAGE_SIZE } from "@/lib/constants";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { sortTorrentFiles } from "@/lib/utils/file";

export function useFileExplorer() {
    const { client, currentAccount } = useAuthGuaranteed();
    const searchParams = useSearchParams();
    const [currentPage, setCurrentPage] = useState(1);

    const sortBy = searchParams.get("sort_by") || (typeof window !== "undefined" && localStorage.getItem("file-sort-by")) || "date";
    const sortOrder = (searchParams.get("sort_order") as "asc" | "desc") || (typeof window !== "undefined" && localStorage.getItem("file-sort-order") as "asc" | "desc") || "desc";

    // Calculate pagination values
    const offset = useMemo(() => (currentPage - 1) * PAGE_SIZE, [currentPage]);
    const limit = PAGE_SIZE;

    const { data, isLoading } = useQuery({
        queryKey: [currentAccount.id, "getTorrentList", currentPage],
        queryFn: () => client.getTorrentList({ offset, limit }),
        placeholderData: keepPreviousData,
        staleTime: 0, // Always revalidate on mount — refetchInterval manages freshness while mounted
        // Adaptive polling: fast when downloads are active, slow when idle
        // Saves ~80% Worker requests vs fixed 3s polling
        refetchInterval: (query) => {
            const files = query.state.data?.files;
            const hasActive = files?.some((f) => f.status === "downloading" || f.status === "waiting" || f.status === "processing");
            return hasActive ? 5000 : 30000;
        },
        refetchIntervalInBackground: false, // Stop polling when tab is hidden
    });

    // Calculate total pages from data
    const totalPages = useMemo(() => {
        if (!data) return currentPage + 1;

        if (data.total !== undefined) {
            return Math.ceil(data.total / PAGE_SIZE);
        }

        if (!data.hasMore) {
            return Math.ceil((offset + data.files.length) / PAGE_SIZE);
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
            setCurrentPage(page);
        }
    };

    return {
        files: sortedFiles,
        isLoading,
        currentPage,
        totalPages,
        setPage,
        sortBy,
        sortOrder,
    };
}
