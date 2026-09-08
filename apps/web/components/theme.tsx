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

/**
 * PROBE (temporary — revert with the rest of the status-bar probe): normally
 * matched to the --paper token in each theme. Two colours nothing else in the
 * app uses, so if the Android status bar shows one of them we know the live
 * meta tag paints it, and that it still follows the in-app toggle.
 */
export const PAPER = { light: "#0000FF", dark: "#FFFF00" } as const;

/**
 * Android paints the status bar from the first <meta name="theme-color">
 * whose media query matches, so the two media-scoped tags in `viewport` track
 * the system setting on their own. A manual toggle has to beat them: this is
 * an unscoped tag inserted ahead of them, removed again on "system".
 */
const OVERRIDE_ID = "theme-color-override";

const script = `try{var t=localStorage.getItem("hajsik.theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;var m=document.createElement("meta");m.id="${OVERRIDE_ID}";m.name="theme-color";m.content=t==="dark"?"${PAPER.dark}":"${PAPER.light}";document.head.insertBefore(m,document.head.firstChild)}}catch(e){}`;

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
  applyThemeColor(theme);
}

function applyThemeColor(theme: Theme): void {
  const existing = document.getElementById(OVERRIDE_ID);
  if (theme === "system") {
    existing?.remove();
    return;
  }
  const meta = existing ?? document.createElement("meta");
  if (!existing) {
    meta.id = OVERRIDE_ID;
    meta.setAttribute("name", "theme-color");
    // First in the head, so it wins over the media-scoped tags behind it.
    document.head.insertBefore(meta, document.head.firstChild);
  }
  meta.setAttribute("content", PAPER[theme]);
}
