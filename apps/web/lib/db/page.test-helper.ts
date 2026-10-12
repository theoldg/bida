// Doc: docs/testing.md#gotchas
import { vi } from "vitest";

/**
 * A stand-in `document` for tests of what parks while the app is hidden:
 * `parked` settles once something waits for the page to be seen again.
 */
export function stubPage() {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  let park!: () => void;
  const parked = new Promise<void>((resolve) => { park = resolve; });
  const listen = page.addEventListener.bind(page);
  page.addEventListener = (...args: Parameters<EventTarget["addEventListener"]>) => {
    if (args[0] === "visibilitychange") park();
    listen(...args);
  };
  vi.stubGlobal("document", page);
  const show = () => {
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
  };
  return { page, parked, show };
}
