# 0014 — Settings belong to the phone, beside the group list

**Status:** Accepted · 2026-08-28
**Amends:** [0012](0012-balances-and-settling-are-one-screen.md) — its
three-item bottom bar and the `/g/options` screen. The rest of 0012 stands.

**Context.** 0012 left an in-group options screen holding an invite button and
two switches — personal mode and colour theme — both device-wide, and both
explaining in hint text that they weren't per-group. A control that has to
explain it isn't what its location implies is in the wrong place. The owner:
*"rename 'group' to 'settings', move it out of the group view and back to the
landing page/group list, and make personal mode enabled by default."*

## Decision

- **`/g/options` is deleted**, and `route.options` with it.
- **`/settings` is the one settings screen**, reached from the group *list's*
  bottom bar next to **Groups**. It holds personal mode and colour theme — the
  two things true of this phone in every group.
- **A group's bottom bar is two items: Expenses · Balances.** Everything else a
  group holds is a top-bar icon on `/g`: History, People, and the invite link
  (per-group, so it couldn't follow the switches to `/settings`).
- **Personal mode ships on.** `DEFAULTS.personalMode` is `true`, and a
  `prefsVersion` marker on the device record carries the new default once to
  phones that already have a record — theirs says `false` because that was the
  default, not because anybody chose it. The migration runs from `getDevice()`
  at app start; a later "Off" sticks.

## Consequences

- Settings is one screen instead of two that could disagree, and it's where the
  other phone-level thing you do — pick a group — already is.
- A group's chrome is now exactly the group: two tabs, three icons.
- `prefsVersion` is device-local, with no index and no op behind it. Bump it and
  set the fields you want re-defaulted next time a default changes. **It must
  never change data** — only preferences the user can see and reverse.
- A bookmarked `/g/options?id=…` gets a 404. Acceptable: it existed for one day
  and nothing links to it.

## Rejected

- **Keep the tab, rename it "Settings"** — the label was the smaller half; the
  location was the rest.
- **Make personal mode per-group** — it's a way of reading, not a property of a
  trip, and per-group state would have to sync or silently not.
- **Flip the default for new installs only** — the people asking are the ones
  who already have the app.
