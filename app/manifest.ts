import type { MetadataRoute } from "next";
import { brandName } from "@/lib/branding";
export const dynamic = "force-dynamic";
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const name = await brandName();
  return {
    name: name,
    short_name: name,
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8f4",
    theme_color: "#176e58",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
