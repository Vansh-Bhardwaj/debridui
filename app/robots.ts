import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://debrid.indevs.in";

    return {
        rules: [
            {
                userAgent: "*",
                allow: ["/"],
                disallow: ["/api/", "/dashboard", "/files", "/accounts", "/settings"],
            },
        ],
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
