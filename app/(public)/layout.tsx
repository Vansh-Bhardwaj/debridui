import { PublicAuthRedirect } from "@/components/common/public-auth-redirect";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <PublicAuthRedirect />
            {children}
        </>
    );
}
