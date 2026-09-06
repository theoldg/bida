/**
 * The theme lives in a data-theme attribute on <html>; the CSS in globals.css
 * handles all three states (system, forced light, forced dark) with no
 * per-component variants. This script runs before paint so a phone set to dark
 * never flashes paper-white on launch.
 *
 * It reads localStorage rather than IndexedDB deliberately: Dexie is async, and
 * anything async here is a flash of the wrong theme. The Dexie device record
 * stays the source of truth and writes through to this key.
 */
const script = `try{var t=localStorage.getItem("hajsik.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

export type Theme = "system" | "light" | "dark";

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
    try { localStorage.removeItem("hajsik.theme"); } catch { /* private mode */ }
  } else {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("hajsik.theme", theme); } catch { /* private mode */ }
  }
}
