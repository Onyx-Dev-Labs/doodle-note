import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = "https://www.doodlenote.ai";
  return ["", "/pricing", "/changelog", "/privacy", "/terms"].map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
