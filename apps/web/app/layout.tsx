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
  // Load-bearing, and not for notches: on Android 15 an app that doesn't draw
  // behind the bars cannot colour them either. `Window.setStatusBarColor` is a
  // no-op from API 35, and it is the call Chrome falls back to for a standalone
  // web app that hasn't asked for cover — while the icon-tint call beside it
  // still lands, which is why the bar went white-on-white rather than simply
  // not changing. With cover, Chrome puts the webapp in short-edges cutout
  // mode and the shell itself paints the strip: `.topbar` pads by
  // env(safe-area-inset-top) over `--card`, so the bar follows `data-theme`
  // exactly, with no browser or manifest in the loop. See frontend.md#pwa.
  viewportFit: "cover",
  // A pinch on a ledger is a mis-grip, not a request to zoom: the layout is
  // already sized for a thumb, and a zoomed page strands the fixed bottom bar
  // off-screen with no obvious way back. Android honours this pair; iOS Safari
  // ignores it in a tab (it obeys it once installed to the home screen), so
  // CSS `touch-action` and `NoPinchZoom` finish the job.
  maximumScale: 1,
  userScalable: false,
  // No `themeColor` here: a `media="(prefers-color-scheme: …)"` pair follows the
  // phone rather than `data-theme`, and the browser takes the first matching
  // one — so it would outrank, not lose to, the correct answer. `ThemeScript`
  // writes the single meta from the resolved theme (components/theme.tsx).
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
