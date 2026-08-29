import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { IconSprite } from "../components/icons";
import { RegisterServiceWorker } from "../components/register-sw";
import { StartSync } from "../components/start-sync";
import { ThemeScript } from "../components/theme";

// One face for the whole app — headings, prose and figures alike; hierarchy is
// carried by weight and tracking instead. Self-hosted at build time by
// next/font, so nothing is fetched from Google at runtime, which matters for a
// PWA that has to render offline.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hajsik",
  description: "Shared expenses, split fairly. Works offline.",
  manifest: "/manifest.webmanifest",
  // Without this every cold load asks for /favicon.ico and takes a 404 for
  // it — a wasted request on the one visit that can least afford one. The
  // PWA icons are already on disk; point at them rather than adding a file.
  icons: {
    icon: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  // "black-translucent" draws the app under the status bar instead of
  // beside it — iOS ignores the manifest's "fullscreen" display entirely for
  // home-screen web apps, so this is the only lever for the same effect there.
  appleWebApp: { capable: true, title: "Hajsik", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matched to the --paper token in each theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1F1EF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0F11" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <ThemeScript />
        <IconSprite />
        <RegisterServiceWorker />
        <StartSync />
        {children}
      </body>
    </html>
  );
}
