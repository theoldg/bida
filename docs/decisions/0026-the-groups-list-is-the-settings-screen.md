# 0026 — The groups list carries the app's name and its one switch

**Status:** Accepted · 2026-08-30
**Supersedes:** [0014](0014-settings-belong-to-the-phone.md) — its `/settings`
screen and `prefsVersion`. Its ruling on the group's own chrome (two tabs,
top-bar icons) stands.

**Context.** The owner: *"add a title at the top of the home screen, and remove
the settings page entirely. dark/bright mode can be a toggle only visible on the
home screen, and personal mode should be always on."*

0014 gave the two device-wide switches a screen of their own, half the bottom
bar, and a tab you passed on every launch. One of them was a taste that never
changes twice, and the other was a way of reading the ledger that the app is
better off simply doing — the app is open to answer *what does this cost me?*,
so the lens that answers it is the app, not a preference.

## Decision

- **`/settings` is deleted**, `route.settings` with it, and the groups list has
  no bottom bar: outside a group there is exactly one destination, so a nav bar
  was a row of chrome pointing at the screen you were already on.
- **The groups list wears the app's name** — the tally wordmark and *Hajsik*,
  with `Your groups` as the sub-line. It's the front door, and the only screen
  whose title wasn't already the thing you'd opened.
- **Light/dark is one icon button, on that screen only.** It shows the theme
  you'd get, not the one you have. The button reads `<html data-theme>` — set
  before first paint by the script in `components/theme.tsx`, while Dexie is
  still opening — and writes through to both localStorage and the device
  record. `theme: "system"` survives as the state of a phone that has never
  been asked; tapping is what replaces it with a choice.
- **Personal mode is the app.** `personalMode`, `setPersonalMode`,
  `usePersonalMode` and the `.personal` wrapper class are gone; the highlighter
  rules apply to `.mine` / `.notmine` directly. With no default left to
  re-issue, `prefsVersion` and `migrateDefaults` go too.

## Consequences

- A phone that had personal mode off gets it on at the next launch, with no
  migration to run — the flag is not read any more.
- Old device records keep a stray `personalMode` / `prefsVersion` key. Harmless:
  nothing is indexed on either, and `updateDevice` spreads what it finds.
- The install offer now lives only in the nudge on the groups list, so its "Not
  now" is final on that phone. The browser's own menu still installs.
- A bookmarked `/settings` 404s.

## Rejected

- **Keep `/settings` for the theme alone.** A screen, a route and a nav item for
  one binary you set once.
- **A three-way light / dark / system control in the top bar.** Three states in
  an icon button means a menu; the toggle answers the question the owner
  actually asks — *is this thing too bright right now?*
- **Put the toggle on every screen's top bar.** It would sit beside History,
  People and the invite link and compete with them for the same thumb, on
  screens that are about a group's money rather than about this phone.
