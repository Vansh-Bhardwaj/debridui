"use client";
export const dynamic = "force-static";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DiscoverIndex() {
    const router = useRouter();
    useEffect(() => { router.replace("/dashboard"); }, [router]);
    return null;
}
