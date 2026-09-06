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
 * Tell the platform what colour the shell's top edge is.
 *
 * In a browser tab and a desktop PWA window this paints the chrome. On an
 * installed Android app it no longer paints anything — the shell draws under
 * the status bar and paints that strip itself (see layout.tsx) — but Chrome
 * still reads it to pick the status-bar icon tint, so it has to keep saying
 * what is actually up there or the clock goes white on white.
 *
 * The obvious version — a pair of `<meta name="theme-color" media="(prefers-
 * color-scheme: …)">` — answers the wrong question: it follows the *phone's*
 * setting, while `data-theme` can override it, and the browser takes the first
 * *matching* meta, so the pair would outrank the correction rather than lose to
 * it. So resolve it from the DOM instead, after `data-theme` is set, and re-run
 * on every change.
 *
 * `--card` rather than `--paper`: on a phone `.app` is full-bleed, so the card
 * is what actually abuts the status bar. Reading the token is what keeps this
 * honest — the colours stay in globals.css, and this can't drift from them.
 *
 * Self-contained on purpose: it is stringified into the pre-paint script below,
 * so it must not reference anything outside itself.
 */
export function syncThemeColor(): void {
  if (typeof document === "undefined") return;
  const card = getComputedStyle(document.documentElement).getPropertyValue("--card").trim();
  if (!card) return;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", card);
}

const script = `try{var t=localStorage.getItem("hajsik.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}
try{var s=${syncThemeColor.toString()};s();matchMedia("(prefers-color-scheme: dark)").addEventListener("change",s)}catch(e){}`;

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
  syncThemeColor();
}
