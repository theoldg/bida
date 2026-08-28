# 0014 — Settings belong to the phone, beside the group list

**Status:** Accepted · 2026-08-28
**Amends:** [0012](0012-balances-and-settling-are-one-screen.md) — its
three-item bottom bar and the `/g/options` screen it kept. The rest of 0012
(settling under the balances, identity on `/g/members`, no rename, less prose)
stands.

## Context

0012 trimmed the in-group options screen down to a "Copy invite link" button
and two switches — personal mode and colour theme — and left it as the third
item in every group's bottom bar, labelled **Group**. Both switches were
already documented as device-wide, and the screen said so in a line of hint
text under each one, which is the tell: a control that has to explain that it
isn't what its location implies is in the wrong place.

The owner, 2026-08-28:

> "rename 'group' to 'settings', move it out of the group view and back to the
> landing page/group list, and make personal mode enabled by default"

## Decision

- **`/g/options` is deleted.** `route.options` goes with it.
- **`/settings` is the one settings screen**, reached from the **Settings**
  item in the bottom bar of the group *list*, next to **Groups**. It carries
  personal mode and colour theme — the two things that are true of this phone
  in every group.
- **The group's bottom bar is two items: Expenses · Balances.** Everything a
  group holds that isn't the ledger is a top-bar icon on `/g`: History, People,
  and now the invite link (which is per-group, so it could not follow the
  switches to `/settings`).
- **Personal mode ships on.** `DEFAULTS.personalMode` is `true`, and a
  `prefsVersion` marker on the device record carries the new default to phones
  that already have one — a record written before today has `personalMode:
  false` because that was the default, not because anybody chose it. The
  migration runs once, from `getDevice()` at app start; a later "Off" sticks.

## Consequences

- Settings is one screen instead of two that could disagree, and it is where
  the other phone-level thing you do — pick a group — already is.
- A group's chrome is now exactly the group: two tabs, three icons.
- Personal mode being on by default answers one of the open questions in
  [product.md](../product.md#open-product-questions).
- `prefsVersion` is a device-local field with no index and no op behind it.
  Bump it, and set the fields you want re-defaulted, next time a default
  changes. It must never be used to change *data* — only preferences the user
  can see and reverse.
- Somebody with `/g/options?id=…` open, or bookmarked, gets a 404 from the
  Worker (`not_found_handling = "404-page"`). Acceptable: the screen existed
  for one day, and nothing links to it.

## Rejected alternatives

- **Keep the tab and rename it "Settings".** The label was the smaller half of
  the problem; the location was the rest. Per-group chrome for a device-wide
  switch is what made "this phone, every group" a necessary sentence.
- **Make personal mode per-group after all.** It is a way of reading, not a
  property of a trip. Nobody wants their share highlighted in Lisbon and hidden
  in Kraków, and per-group state would have to sync or silently not.
- **Flip the default for new installs only.** That is the same as not doing it:
  the people asking are the ones who already have the app.
