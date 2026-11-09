import type { MetadataRoute } from "next";
import { helpGuides } from "../content/help-guides";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = "https://www.doodlenote.ai";
  return [
    "",
    "/download",
    "/pricing",
    "/changelog",
    "/contact",
    "/privacy",
    "/terms",
    "/help",
    ...helpGuides.map(({ slug }) => `/help/${slug}`),
  ].map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
