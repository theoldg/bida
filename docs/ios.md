# iOS: the tab and the home-screen app are two phones

*For: anyone touching joining, installing or storage on iPhone. **Status:
proposal** — the problem is real and shipped; the fix below is not built. When
it is, the decision becomes an ADR and this doc shrinks to how it works.*

## The problem

On Android an installed PWA and the browser share one origin: one IndexedDB,
and Chrome hands a tapped in-scope link to the installed app. On iOS none of
that holds, and every iOS browser is WebKit, so none of it is Safari's alone:

1. **A tab forgets.** WebKit deletes script-writable storage (IndexedDB) for a
   site not interacted with in seven days of browser use, and refuses
   `persist()` to tabs. A home-screen web app is exempt. What dies is
   `groupKeys` — the only copy of each secret on the phone — plus any unpushed
   op and the device's identity claim ([lib/persist.ts](../apps/web/lib/persist.ts)).
2. **A link always opens the tab.** There are no universal links for web apps
   and no link capturing: a tapped invite in Messages or WhatsApp lands in
   Safari, never in the icon on the home screen.
3. **The tab and the app don't share storage.** A group joined in Safari does
   not exist in the home-screen app, and vice versa. The only channels between
   them are the clipboard and the server — and the server cannot help, because
   nothing identifies the same phone on both sides without an account
   ([ADR-0003](decisions/0003-link-only-access.md)).

So a person who means to stay in a group has to end up in the home-screen app,
and every invite starts them in the wrong place.

## What is built today

- The install nudge on the groups list, with the iOS-only warning that the tab
  forgets after a week ([frontend.md](frontend.md#pwa)).
- **Paste link**, a third start tile shown only in an iOS home-screen app,
  because that is the only way a link gets in there.
- `persist()` requested on every start once a group is held.

The permanent-join path is therefore: tap invite → Safari joins the group →
read the nudge → Share → More → Add to Home Screen → find the icon → Paste link
→ Paste bubble → pick who you are **again** (the tab's claim is in the other
storage). Two identity claims from one person, and the first sits in the
history forever.

## What eviction actually costs a tab user

Worth weighing before we build a wall. The group lives on the server, sealed; a
tab loses only the *key to it on this phone*:

- **The groups list** — but the invite is still in the chat it came from, and
  tapping it again rejoins in one tap.
- **The identity claim** — re-picking a name publishes a second device claim.
- **Unpushed ops** — only if the phone was offline when they were made *and*
  never online in the seven days after. Rare.

So the casual user ("what do I owe?") loses almost nothing by staying in the
tab. The person who suffers is the regular who never knew, opens it after a
fortnight away and finds an empty app. The goal is to stop the regular *drifting*
into tab use, not to lock the casual one out.

## Approaches

| | Idea | Verdict |
|---|---|---|
| A | **The icon carries the invite.** On iOS the home-screen icon starts at the manifest's `start_url`, or the page's own URL (fragment included) when there is none. If `/join#id.secret` installs *as itself*, the first launch of the icon is the join — no paste | **Best if it works. Experiment first** |
| B | **`/join` in an iOS tab forks instead of joining** — see below | Build — the framing for everything else |
| C | **Every tap on the fork copies the link**, so whichever app opens next is one Paste away | Build: the returning user's whole path, and new users' fallback if A fails |
| D | **Hard gate** — no group in an iOS tab at all | Rejected: breaks the casual check, and a tab user loses little |
| E | **Server hand-off** (tab parks the key, app collects it) | Rejected: nothing links the two sides without a code the person types, which is worse than paste — and a key on the server undoes [ADR-0036](decisions/0036-the-server-cannot-read-a-group.md) |
| F | **Shortcuts / URL schemes / QR / share target** | Rejected: none of them open a web app, the camera opens Safari too, and iOS has no Web Share Target |
| H | **Detecting the installed app from the tab** | Impossible: no shared storage or cookies, and no `getInstalledRelatedApps` on iOS. The tab must serve both people |
| G | **Move the tab's claim into the app** | Falls out of A or C for free if the claim rides with the link (below) |

### A, in detail — the experiment

Two ways to make the icon start at the invite, to try on a real iPhone:

1. **`/join` without the static manifest link.** iOS then uses the page URL.
   Name and icon come from `apple-touch-icon` and `apple-mobile-web-app-title`,
   standalone from `apple-mobile-web-app-capable`. Cheapest to try.
2. **A manifest written at runtime** — `/join` swaps `<link rel="manifest">` for
   a `blob:` URL whose `start_url` is `/join#id.secret`. Keeps one manifest's
   worth of metadata; WebKit may not read a swapped manifest at all.

Questions the experiment answers: does the fragment survive into the launched
icon; does it survive a reboot; what does Android do with the same page (it
must keep `start_url: "/"` there, since it shares storage and needs none of
this).

Consequences if it works: that icon opens that group on every cold launch.
`/join` already opens a held group without asking anything
([frontend.md](frontend.md#routing)), so this reads as "the icon opens my group",
which is arguably right. A second group still comes in by Paste link. The
secret sits in the home-screen bookmark — on the phone that already holds it.

### Carrying the claim across

Whichever path moves the link into the app can carry *who you are* with it —
`#id.secret.memberId`, set only on the hand-off URL, never on the shared invite.
The app then claims on arrival and the tab never publishes a claim at all if
the join screen asks to install *before* asking who you are (B). One person,
one claim.

## Proposed flow: `/join` in an iOS tab asks before it joins

Today the tab joins on arrival. That is wrong for both people it can't tell
apart: a new user's first claim lands in storage that is about to be left
behind, and a regular with the app gets a second copy of the group in a tab.
So in an iOS tab only (Android and the home-screen app are unchanged), `/join`
saves nothing and offers three rows, each a tap that **copies the link first**:

1. **Open in bida** — for the regular. "Copied. Open bida and tap Paste link."
2. **Add bida to your home screen** — for the new user. The share-sheet steps,
   drawn as the nudge draws them; with A, the icon then opens the group, and
   without it the copy is waiting for Paste link.
3. **Just look** — joins in the tab, with the week's warning.

The order is the one open decision below. The tab may remember which row was
taken last and lead with it — a hint that evicts with everything else, which
costs only a return to the default.

The two journeys, then:

- **New:** invite → fork → Add to home screen → Share → Add → tap the icon →
  the group (A) or Paste link (C) → who are you.
- **Regular, second group:** invite → fork → Open in bida → switch to the app →
  Paste link → Paste bubble → who are you. Still a paste — nothing on iOS
  carries a link into a running web app — but it is *said* at the moment it is
  needed, by the screen the person is already looking at, instead of being
  something to know.

In the app nothing changes: **Paste link** is already a start tile that stays
in reach under a long list ([frontend.md](frontend.md#one-navigation)).

## Open questions for the owner

- Which row leads the fork: **Add to home screen** (most arrivals are new) or
  **Open in bida** (a regular joins more groups than a newcomer)? And does
  "Just look" exist at all?
- With A, a regular who picks the wrong row installs a second icon. Acceptable,
  or does the install row warn "already have bida? use the row above"?
- Is an icon that always opens *one* group acceptable, or must the icon open
  the groups list after the first launch (then A needs a "consumed" flag in the
  app's storage)?
- Does a tab that already holds groups get nagged harder than the foot-of-list
  nudge — e.g. a banner once a group is a week old?

## Gotchas

- `looksIos` has to catch iPadOS, which calls itself a Mac
  ([lib/install.ts](../apps/web/lib/install.ts)).
- `navigator.clipboard.readText()` on iOS draws its own Paste bubble even after
  a tap — a paste is always two taps.
