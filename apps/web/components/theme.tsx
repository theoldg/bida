// Doc: docs/design-system.md
/**
 * The theme lives in a data-theme attribute on <html>; the CSS in globals.css
 * handles all three states (system, forced light, forced dark) with no
 * per-component variants. This script runs before paint so a phone set to dark
 * never flashes paper-white on launch.
 *
 * It reads localStorage rather than IndexedDB deliberately: Dexie is async, and
 * anything async here is a flash of the wrong theme. The Dexie device record
 * stays the source of truth and writes through to this key — but only when
 * the toggle is pressed, so nothing restores the key if it goes missing.
 * That is why the script still reads the pre-rebrand `hajsik.theme` and
 * promotes it: dropping it would silently put every phone back on system.
 *
 * It also says `lang` on <html> for a phone `/diag` switched to Polish
 * (lib/lang.ts), so a screen reader reads the words in the right voice.
 */
const script = `try{var t=localStorage.getItem("bida.theme")||localStorage.getItem("hajsik.theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;localStorage.setItem("bida.theme",t)}if(localStorage.getItem("bida.lang")==="pl")document.documentElement.lang="pl"}catch(e){}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

/** Forced either way. Following the phone is only ever the start: nothing here takes a phone back to it. */
export function applyTheme(theme: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("bida.theme", theme); } catch { /* private mode */ }
}
