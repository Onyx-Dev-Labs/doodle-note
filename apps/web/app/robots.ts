import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/app/", "/invite/", "/link-device"],
    },
    sitemap: "https://www.doodlenote.ai/sitemap.xml",
  };
}
