// Doc: docs/pwa.md
import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { preview } from "@/lib/preview";

// The card a chat shows under a quick split's message. It can't name the bill:
// the split is in the fragment, which no scraper is sent.
export const metadata: Metadata = preview(copy.app.split);

export default function SplitLayout({ children }: { children: React.ReactNode }) {
  return children;
}
