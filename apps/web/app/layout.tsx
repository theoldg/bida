import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { IconSprite } from "../components/icons";
import { KeyboardInset } from "../components/keyboard-inset";
import { NoLongPress } from "../components/no-long-press";
import { NoPinchZoom } from "../components/no-pinch-zoom";
import { RegisterServiceWorker } from "../components/register-sw";
import { StartSync } from "../components/start-sync";
import { ThemeScript } from "../components/theme";
import { copy } from "../lib/copy";

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
  title: copy.app.name,
  description: copy.app.description,
  manifest: "/manifest.webmanifest",
  // Without this every cold load asks for /favicon.ico and takes a 404 for
  // it — a wasted request on the one visit that can least afford one. The
  // PWA icons are already on disk; point at them rather than adding a file.
  icons: {
    icon: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  // "default" keeps the status bar beside the app rather than under it — iOS
  // ignores the manifest's `display` entirely for home-screen web apps, so
  // this is the lever that matches `standalone` there.
  appleWebApp: { capable: true, title: copy.app.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Still cover: the status bar is its own strip now, but the home indicator
  // and a landscape notch are not, and the bars pad for them with
  // env(safe-area-inset-*) — which reads 0 unless the viewport covers them.
  viewportFit: "cover",
  // A pinch on a ledger is a mis-grip, not a request to zoom: the layout is
  // already sized for a thumb, and a zoomed page strands the fixed bottom bar
  // off-screen with no obvious way back. Android honours this pair; iOS Safari
  // ignores it in a tab (it obeys it once installed to the home screen), so
  // CSS `touch-action` and `NoPinchZoom` finish the job.
  maximumScale: 1,
  userScalable: false,
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
        <KeyboardInset />
        <NoLongPress />
        <NoPinchZoom />
        <RegisterServiceWorker />
        <StartSync />
        {children}
      </body>
    </html>
  );
}
