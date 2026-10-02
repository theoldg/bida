import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { preview } from "@/lib/preview";

// Every invite is a `/join#…` link, so this is the card a chat shows for one.
// The tab keeps the app's name: the page is gone in a second.
export const metadata: Metadata = preview(copy.app.invite);

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
