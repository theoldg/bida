# iOS: the tab and the home-screen app are two phones

*For: anyone touching joining, installing or storage on iPhone. **Status:
[the design](#the-design) is built, and so is [experiment A](#a-in-detail--the-experiment)
— what it is waiting on is a real iPhone.** Its answer settles `/install`'s last
step, and then the decision becomes an ADR and this doc shrinks to how it works.*

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

## What was built before the design

- `persist()` requested on every start once a group is held.
- **Paste link**, a third start tile shown only in an iOS home-screen app,
  because that is the only way a link gets in there.

Without the design, the permanent-join path was: tap invite → Safari joins →
read the nudge → Share → Add to Home Screen → open the icon → Paste link → pick
who you are **again**. Two claims from one person, the first in the history
forever.

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
| A | **The icon carries the invite.** On iOS the home-screen icon starts at the manifest's `start_url`, or the page's own URL (fragment included) when there is none. If the page someone installs from carries `#id.secret`, the first launch of the icon is the join — no paste | Built, both halves — **unverified on a real iPhone**, and that answer decides the tutorial's last step |
| B | **Ask before joining, and explain installing on one shared screen** — [the design below](#the-design) | Built |
| C | **The join choice copies the link** — its box, and Add to home screen on the way to `/install` — so the app is one Paste away | Built: the regular's whole path, and the newcomer's if A fails |
| D | **Hard gate** — no group in an iOS tab at all | Rejected: breaks the casual check, and a tab user loses little |
| E | **Server hand-off** (tab parks the key, app collects it) | Rejected: nothing links the two sides without a code the person types, which is worse than paste — and a key on the server undoes [ADR-0036](decisions/0036-the-server-cannot-read-a-group.md) |
| F | **Shortcuts / URL schemes / QR / share target** | Rejected: none of them open a web app, the camera opens Safari too, and iOS has no Web Share Target |
| H | **Detecting the installed app from the tab** | Impossible: no shared storage or cookies, and no `getInstalledRelatedApps` on iOS. The tab must serve both people |
| — | **A third "Open in bida" button on the join screen** | Dropped: the join screen's link box serves the regular |

### A, in detail — the experiment

`/install` is the page the share sheet is opened from — whatever iOS writes
into the bookmark, it writes from there — so that is where both halves live
(`lib/install.ts`, `app/install/page.tsx`).

1. **The page's own URL.** `route.install(link)` is `/install#<id>.<secret>`,
   and every way in passes one: the join screen's **Add to home screen**, and
   the groups list's banner, which carries the group at the top of the list.
   With no readable manifest iOS bookmarks the URL it is looking at, fragment
   included. Name, icon and standalone come from the `apple-*` tags either way.
2. **The manifest.** On an iOS tab the app's `<link rel="manifest">` has its
   href swapped for a `blob:` manifest whose `start_url` is `/join#id.secret`,
   for a WebKit that reads the link as it stands when the share sheet opens.

Both ends are wired, so whichever URL survives, the icon's first launch joins:
`/join#…` is the app's own route, and `/install#…` hands the invite to it. A
fragment whose secret this phone already holds is spent — the app starts where
the app starts, rather than the icon being one group's door forever.

**What the iPhone answers**: does the fragment survive into the launched icon;
does it survive a reboot; and which half did it — the two land on different
URLs, so the app that opens says which. `pnpm homescreen` covers everything
around that in a real browser ([testing.md](testing.md#pnpm-homescreen--the-invite-that-rides-onto-the-home-screen)),
Android included: it must keep `start_url: "/"`, since it shares storage and
needs none of this.

Consequences if it works: a second group still comes in by Paste link, and the
secret sits in the home-screen bookmark — on the phone that already holds it.
If it doesn't, nothing is worse than before: the link is on the clipboard and
the app starts empty, which is what the tutorial's last step already says.

## The design

Everything here is **iOS tab only** (`offerFrom` → `manual`). Android and the
home-screen app are unchanged. Wording is in `copy.install` and `copy.join.choice`.

### `/install` — the tutorial, shared

A route of its own, in `/about`'s register: short prose, no cards, kept to the
few lines someone reads before they've decided this is worth their time. Every
"this browser" on these screens names Safari or Chrome when `iosBrowser` can
tell. It carries, in this order:

1. untitled — Safari may forget your groups after a week unopened; the invite
   link always brings them back. Then, for whoever wants to keep everything
   permanently, one bold line: add bida to your home screen.
2. untitled — a recording of Safari's share sheet down to Add
   (`public/media/`, from `docs/media/safari-add-to-home-screen.mp4`; left out
   of the precache).
3. **It starts empty** — the home-screen app can't see the tab's data; open
   group invites in the app to transfer them.

The same page whether it came from the banner or the join screen. Back is a
plain back, and the only exit: the way forward is out of the browser.

### Home — the banner

A card at the top of the groups list, *Keep your groups on this phone /
Safari may forget them*, with **Add to home screen** into `/install` — carrying
the invite of the group at the top of the list, which is the one the app would
reopen by itself — **shown only once the tab holds a group**. An empty home is
someone looking around: Quick split stores nothing and is the right way to try bida, and a
visitor won't install an app sight unseen. Once a group is in the tab,
"Safari may forget it" is true and worth saying at the top rather than the
foot. It replaces the install nudge in a tab, and folds like it, on the same
device flag: a warning someone who chose Safari can't put away is nagging.

### `/join` — the choice, before "who are you"

A full screen, drawn before the claim gate, titled with the group, whole block
centred. It is read by someone who has seen nothing of bida, so it skips the
paragraph and puts the reason under each button instead — an install ask
with a wall of text up top reads as the app wanting something. In order:
*Join Lisbon*; **Add to home screen** with *keep everything on this phone,
forever, no download required* under it; **Continue in Safari** (or Chrome, or
"the browser" when it can't tell) with *Safari may forget the group — the link
re-opens it* under it; then, in a lower-contrast card, *Already on home
screen?* and the link in a box that is its own copy button, reading
**Copied** once a write has gone through — tried on arrival too, though iOS
only allows it inside a tap.

- **Add to home screen** — `.btn-lg`, ink. Copies the link, opens `/install`
  with the invite in its fragment ([experiment A](#a-in-detail--the-experiment)),
  by `location.assign` — a fragment is the one thing Next's router drops.
- **Continue in Safari** — outlined, staying in the tab.

The key is saved and the group pulled *behind* the screen, so its title can be
the group's name — an invitation, not a wall. Nothing is published until a name
is picked, so choosing Add to home screen leaves an unclaimed copy in the tab that
evicts harmlessly: one person, one claim. A group this phone has claimed skips
the screen (`asksBeforeJoin`, `meByGroup`). An unclaimed one — never named, or
forgotten since — asks on every opening of its link; Continue only answers for
that opening, and is not stored.

## Open questions for the owner

- Does **New group** in a tab get the same choice as `/join`? Its key exists
  nowhere but that tab until the link is shared — worse than joining.
- A tab holding several groups brings them over one paste at a time. Is
  re-opening each invite from the chat enough?
- Safari's "Add to Dock" web apps on a Mac have the same split storage and the
  same week; `looksIos` excludes a real Mac. In scope?

## Gotchas

- `looksIos` has to catch iPadOS, which calls itself a Mac
  ([lib/install.ts](../apps/web/lib/install.ts)).
- `navigator.clipboard.readText()` on iOS draws its own Paste bubble even after
  a tap — a paste is always two taps.
- A pasted join link is opened with `location.assign`, not `router.push`. When
  Next's router gives up and loads the page itself — say the build it fetched
  isn't the one on screen, which is easy on a freshly installed app — it
  uses the fetch's URL, and that has no `#`. The join then said "Bad link", and
  pasting again worked because that page load had brought the app up to date.
- **A `<link rel="manifest">` taken out of the head comes back.** Next owns
  that element and re-inserts it after hydration, leaving two manifests with
  the static one winning. Swap its href instead — a manifest that fails to
  fetch falls back to the document URL anyway, which is the other half of
  experiment A.
