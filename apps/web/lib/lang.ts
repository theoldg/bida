// Doc: docs/frontend.md#every-word-in-libcopyts
/**
 * Which language the app speaks, in `localStorage` like the theme: `copy` is
 * picked once as the app loads, before any database could answer. Set only from
 * `/diag` until Polish is finished.
 */
export type Lang = "en" | "pl";

const KEY = "bida.lang";

export function chosenLang(): Lang {
  try {
    return localStorage.getItem(KEY) === "pl" ? "pl" : "en";
  } catch {
    return "en";
  }
}

/** Takes effect on the next load: `copy` is a constant every screen imported. */
export function setLang(lang: Lang): void {
  try {
    if (lang === "pl") localStorage.setItem(KEY, "pl");
    else localStorage.removeItem(KEY);
  } catch { /* private mode: nothing to switch, and English stays */ }
}
