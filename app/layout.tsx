import type { Metadata, Viewport } from "next";
import { brandName } from "@/lib/branding";
export const dynamic = "force-dynamic";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./globals.css";
import "leaflet/dist/leaflet.css";
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await brandName(),
    description: "Доставка по пути в Узбекистане",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default" },
  };
}
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#176e58",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
