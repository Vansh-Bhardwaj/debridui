"use client";
export const dynamic = "force-static";

import { Suspense } from "react";
import { FileExplorer } from "@/components/explorer/file-explorer";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";

export default function AccountPage() {
    const { currentAccount } = useAuthGuaranteed();
    return (
        <Suspense>
            <FileExplorer key={currentAccount.id} />
        </Suspense>
    );
}
