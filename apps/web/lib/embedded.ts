/**
 * The in-app browser: the webview Instagram, Messenger and the rest open a
 * tapped link in, instead of handing it to the phone's browser.
 *
 * It is a dead end for this app rather than a slower road to the same place.
 * Its storage is its own and nothing can reach back into it; there is no Add
 * to Home Screen in it; and a group joined there is claimed a *second* time
 * the moment the person opens the same link properly — the duplicate claim
 * [docs/ios.md](../../../docs/ios.md) exists to prevent, arrived at by the
 * commonest route there is. So the app refuses to run in one and says how to
 * get out (`components/embedded.tsx`).
 *
 * **The bar is proof, not suspicion.** A false positive locks somebody out of
 * a real browser, which is far worse than letting a webview through, so a
 * browser that names itself is believed before anything else here is read.
 */

/**
 * Browsers that say who they are. Checked first and alone: every one of these
 * is a real browser with a real share sheet, and several are WebKit builds
 * whose user agent is otherwise Safari's to the character (Brave, DuckDuckGo).
 * A webview that spoofed one of these would get in — which is the direction to
 * be wrong in.
 */
const NAMED_BROWSER =
  /(?:CriOS|FxiOS|EdgiOS|OPiOS|OPT|OPR|Edg|Firefox|SamsungBrowser|YaBrowser|Vivaldi|Brave|DuckDuckGo|UCBrowser|HuaweiBrowser|MiuiBrowser|QQBrowser)\//;

/**
 * Apps whose webview names itself, which is what lets the screen say "Instagram"
 * rather than "this app". Not the detection's backbone — the two structural
 * signals below catch these and everything else — but a token is proof on its
 * own, and covers a host that puts `Safari/` back.
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
 * Is this an in-app browser?
 *
 * Three signals, any of which is conclusive, and all of which a named browser
 * overrides:
 *
 * 1. **A token above** — the app said so.
 * 2. **`; wv)`** — Android's WebView writes it into the platform token, and
 *    Chrome, Samsung Internet and the rest do not. Chrome Custom Tabs is real
 *    Chrome and carries no `wv`, so an app that uses it is rightly let through:
 *    it shares Chrome's storage and its menus.
 * 3. **An iOS page with no `Safari/` token** — WKWebView drops it and every
 *    shipping iOS browser keeps it, Brave and DuckDuckGo included.
 *
 * `standalone` is not a nicety: **an iOS home-screen web app has no `Safari/`
 * token either**, so without this gate the app would lock itself out of the
 * very place it spends its time asking people to go.
 */
export function looksEmbedded(
  { ua, ios, standalone }: { ua: string; ios: boolean; standalone: boolean },
): boolean {
  if (standalone || NAMED_BROWSER.test(ua)) return false;
  if (IN_APP.some(([token]) => token.test(ua))) return true;
  if (/;\s*wv[;)]/.test(ua)) return true;
  return ios && !/Safari\//.test(ua);
}
