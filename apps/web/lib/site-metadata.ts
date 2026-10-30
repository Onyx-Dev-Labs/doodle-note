import type { Metadata } from "next";

const title = "DoodleNote";
const description = "AI meeting notes without the bot";
const image = {
  url: "/social/doodlenote-home-v1.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "DoodleNote — Be in the moment. Keep the good stuff. The homepage's illustrated meeting note and doodle mascot on forest green.",
};

// Static, public branding only: never include meeting titles or note content.
// Keep the production origin consistent with sitemap.ts and the domain redirect.
export const siteMetadata: Metadata = {
  metadataBase: new URL("https://www.doodlenote.ai"),
  title,
  description,
  icons: {
    icon: { url: "/mascot.png", type: "image/png", sizes: "249x249" },
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  openGraph: {
    type: "website",
    siteName: title,
    title,
    description,
    images: [image],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
  },
};
