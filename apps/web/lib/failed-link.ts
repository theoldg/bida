/**
 * The link a "Bad link" or "missing its password" screen is about, so the
 * screen can show it: a person who can see what they opened can tell a typo,
 * a truncated paste or the wrong copied thing from a link that really is bad.
 *
 * Opened, that is the address itself. Pasted, it is what was on the clipboard,
 * which the screen's address no longer says — pasting sends a `/g?id=` link to
 * the group, and junk to a bare `/join`. So pasting notes the text here, in
 * memory, against the address it sent you to: never in that address, where a
 * query string would carry whatever was on the clipboard to the server's logs.
 * A note only counts while you are still on the address it names, so opening
 * some other link later shows that link, not an old paste.
 */

let note: { text: string; at: string } | undefined;

/** Pasting `text` is sending you to `at` (a path with its query and hash). */
export function notePasted(text: string, at: string): void {
  note = { text: text.trim(), at };
}

export function failedLink(): string {
  const { pathname, search, hash, href } = window.location;
  return note && note.at === pathname + search + hash ? note.text : href;
}
