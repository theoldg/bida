// Doc: docs/ios.md#the-in-app-browser--refused
/**
 * The in-app browser — Instagram's, Messenger's — which the app refuses to run
 * in (`components/embedded.tsx`). The bar is proof, not suspicion.
 */

/**
 * Browsers that say who they are, checked first and alone: some are WebKit
 * builds whose user agent is otherwise Safari's exactly (Brave, DuckDuckGo).
 * A webview spoofing one gets in — the right direction to be wrong in.
 */
const NAMED_BROWSER =
  /(?:CriOS|FxiOS|EdgiOS|OPiOS|OPT|OPR|Edg|Firefox|SamsungBrowser|YaBrowser|Vivaldi|Brave|DuckDuckGo|UCBrowser|HuaweiBrowser|MiuiBrowser|QQBrowser)\//;

/**
 * Apps whose webview names itself, so the screen can say "Instagram". The
 * structural signals below catch these anyway; a token also covers a host
 * that puts `Safari/` back.
 */
const IN_APP: [RegExp, string][] = [
  // `Orca` is Messenger's own name for itself on Android, and it rides in the
  // same `FB_IAB` token Facebook's webview uses — so it has to be read before
  // the Facebook line below, or Messenger tells people it is Facebook.
  [/FBAN\/MessengerFor|FB_IAB\/Orca|Messenger(?:Lite)?\//, "Messenger"],
  [/Instagram/, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/, "Facebook"],
  [/LinkedInApp/, "LinkedIn"],
  [/TikTok|musical_ly|BytedanceWebview/, "TikTok"],
  [/Snapchat/, "Snapchat"],
  [/Twitter for/, "X"],
  [/Pinterest/, "Pinterest"],
  [/MicroMessenger/, "WeChat"],
  [/Line\//, "LINE"],
  [/KAKAOTALK/, "KakaoTalk"],
  [/GSA\//, "the Google app"],
];

/** The app whose browser this is, when it says so. For copy, never for the verdict. */
export function embeddedApp(ua: string): string | undefined {
  if (NAMED_BROWSER.test(ua)) return undefined;
  return IN_APP.find(([token]) => token.test(ua))?.[1];
}

/**
 * Is this an in-app browser? Any one signal is conclusive, and a named
 * browser overrides all of them:
 *
 * 1. **A token above** — the app said so.
 * 2. **`; wv)`** — Android WebView writes it; Chrome and the rest don't.
 *    Chrome Custom Tabs carries no `wv` and is rightly let through: it shares
 *    Chrome's storage.
 * 3. **An iOS page with no `Safari/` token** — WKWebView drops it, every
 *    shipping iOS browser keeps it.
 *
 * **An iOS home-screen web app has no `Safari/` token either**, so without the
 * `standalone` gate the app would lock itself out of its own install.
 */
export function looksEmbedded(
  { ua, ios, standalone }: { ua: string; ios: boolean; standalone: boolean },
): boolean {
  if (standalone || NAMED_BROWSER.test(ua)) return false;
  if (IN_APP.some(([token]) => token.test(ua))) return true;
  if (/;\s*wv[;)]/.test(ua)) return true;
  return ios && !/Safari\//.test(ua);
}
