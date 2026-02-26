"use client";
export const dynamic = "force-static";

import { AddAccountForm } from "@/components/accounts/add-account-form";
import { PageHeader } from "@/components/common/page-header";
import { UserPlus } from "lucide-react";

export default function AddAccountPage() {
    return (
        <div className="mx-auto w-full max-w-4xl space-y-8 pb-16">
            <PageHeader
                icon={UserPlus}
                title="Add Account"
                description="Connect a new debrid service account"
                divider
            />

            <div className="max-w-md mx-auto">
                <AddAccountForm />
            </div>
        </div>
    );
}
