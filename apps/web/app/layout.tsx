import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Karla, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { IconSprite } from "../components/icons";
import { ThemeScript } from "../components/theme";

// Self-hosted at build time by next/font — nothing is fetched from Google at
// runtime, which matters for a PWA that has to render offline.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Karla({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hajsik",
  description: "Shared expenses, split fairly. Works offline.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Hajsik", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matched to the --paper token in each theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E9ECE2" },
    { media: "(prefers-color-scheme: dark)", color: "#11150E" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <ThemeScript />
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
