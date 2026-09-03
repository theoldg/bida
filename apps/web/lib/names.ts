/**
 * Two people, one name.
 *
 * A member is only ever shown as the name somebody typed — the ledger, the
 * split editor, the payer chips and the balances all carry a bare name and
 * nothing else. So a second "Ana" is not a duplicated row you can tidy up
 * later: it is two people who cannot be told apart anywhere in the app, one of
 * them quietly holding half the bill. There is no id on screen to fall back
 * on, so the second one is refused at the field that would create it.
 *
 * Same-name is judged by what a person reads, not by bytes: spaces around it,
 * a double space inside it and capitals are all the same name to everyone
 * looking at the list. NFC first, so a typed "é" matches a composed one.
 */
export function nameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Is this name already one of `taken`? Blank is nobody, so it is never taken. */
export function nameTaken(name: string, taken: readonly string[]): boolean {
  const key = nameKey(name);
  return key.length > 0 && taken.some((other) => nameKey(other) === key);
}
