"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Plus, RefreshCw, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountCard } from "@/components/accounts/account-card";
import { PageHeader } from "@/components/common/page-header";
import { useAuth } from "@/components/auth/auth-provider";
import { EmptyState } from "@/components/common/async-state";

export default function AccountsPage() {
    const router = useRouter();
    const { userAccounts, currentAccount, refetchAccounts } = useAuth();
    const [isRefreshing, setIsRefreshing] = useState(false);

    const currentAccountId = currentAccount?.id;

    const handleAddAccount = useCallback(() => {
        router.push("/accounts/add");
    }, [router]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await refetchAccounts();
        setIsRefreshing(false);
    }, [refetchAccounts]);

    return (
        <div className="mx-auto w-full max-w-4xl space-y-8 pb-16">
            <PageHeader
                icon={KeyRound}
                title="Accounts"
                description="Manage your debrid service accounts"
                divider
                action={
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline">
                            <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                        <Button onClick={handleAddAccount}>
                            <Plus className="size-4" />
                            Add Account
                        </Button>
                    </div>
                }
            />

            {userAccounts.length === 0 ? (
                <EmptyState
                    title="No accounts added yet"
                    description="Add your first debrid account to get started."
                    className="py-12"
                />
            ) : (
                <div className="space-y-3">
                    {userAccounts.map((account) => (
                        <AccountCard
                            key={account.id}
                            account={account}
                            isCurrentAccount={account.id === currentAccountId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
