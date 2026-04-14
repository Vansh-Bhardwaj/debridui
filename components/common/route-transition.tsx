"use client";

import { usePathname } from "next/navigation";

export function RouteTransition({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <div key={pathname} className="route-enter motion-reduce:animate-none min-h-0">
            {children}
        </div>
    );
}
