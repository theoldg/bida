# iOS: the tab and the home-screen app are two phones

*For: anyone touching joining, installing or storage on iPhone. **Status:
[the design](#the-design) is built and [A](#a-in-detail) works on a real
iPhone.** Not yet tried on a phone: the in-app browser's banner and its way out —
[the phone checklist](on-a-phone.md) is how to spend
one.*

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
4. **An in-app browser is a third storage, and a dead end.** Instagram,
   Messenger and the rest open a tapped link in a webview of their own: no
   share sheet to install from, storage nothing can reach back into, and a
   claim made there is made again the moment the link is opened properly. It
   is the commonest way an invite is tapped, and the setting that turns it off
   goes back on at the app's next update — so the app runs there as a one-off
   visit, under a banner saying so ([below](#the-in-app-browser--a-one-off-visit)).
   Android's WebView is the same dead end, which is the one part of this doc
   that is not iOS's alone.
5. **A home-screen app cannot download a file.** As of iOS 18.4 an
   `<a download>` or a `Content-Disposition: attachment` does not fail — it
   replaces the app with a full-screen "Open in …" that has **no way back**, so
   a phone that tried it loses the app rather than gaining a file. The share
   sheet is the way out instead (`navigator.share` with a file, which Safari
   has taken since 15, and whose sheet holds Save to Files), so the export
   gates the download on `iosHomeScreenApp` rather than trying it first —
   dropping to it after a failed share is how somebody ends up stranded
   ([import-export.md](import-export.md#getting-a-group-off-the-phone)). A tab is fine:
   Safari has a real download manager.

So a person who means to stay in a group has to end up in the home-screen app,
and every invite starts them in the wrong place.

Two things stand under everything below: `persist()`, requested on every start
once a group is held, and **Paste link**, a start tile drawn only in an iOS
home-screen app — the only way a link gets into one.

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
| A | **The icon carries the invite.** On iOS the home-screen icon starts at the manifest's `start_url`, or the page's own URL (fragment included) when there is none. If the page someone installs from carries `#id.secret`, the first launch of the icon is the join — no paste | **Works on iPhone**, from `/install` and from an ordinary page with the names along — so it is the manifest that carries. Paste link stays for groups joined after the install |
| B | **Ask before joining**, a full screen of Add to home screen / Continue in Safari | Rejected: A carries every group from any page, so the banner asks, and a question here stands between a newcomer and the group |
| C | **The claim screen offers the link** — [*Have the app?*](#gclaim--have-the-app) — so the app is one Paste away | Built: the regular's whole path, and the newcomer's if A fails |
| D | **Hard gate** — no group in an iOS tab at all | Rejected: breaks the casual check, and a tab user loses little. A webview was gated once, for the same wrong reason: what it loses is a second claim and a key the chat still holds |
| E | **Server hand-off** (tab parks the key, app collects it) | Rejected: nothing links the two sides without a code the person types, which is worse than paste — and a key on the server undoes [ADR-0036](decisions/0036-the-server-cannot-read-a-group.md) |
| F | **Shortcuts / URL schemes / QR / share target** | Rejected: none of them open a web app, the camera opens Safari too, and iOS has no Web Share Target |
| H | **Detecting the installed app from the tab** | Impossible: no shared storage or cookies, and no `getInstalledRelatedApps` on iOS. The tab must serve both people |

### A, in detail

**What an icon carries**: every group the tab holds and who the tab is in each
(`heldInvites`), as `/install#<id>.<secret>[.<member>]~…`. Forgotten groups
are left out. The tab is what forgets, so a group left behind is a paste to do
later for nothing; `~` and `.` cannot occur in any part. Name, icon and
standalone come from the `apple-*` tags either way.

**How, from any page** (`lib/install.ts`). Safari takes the manifest a page
*loaded* with, so it has to be right before anything reads the head:

1. **No page's HTML has a manifest.** `manifestScript`, inline and first in
   `app/layout.tsx`'s head, writes the link: the static one, except in an iOS
   tab holding groups, where it is a `blob:` whose `start_url` is the carry.
   IndexedDB can't answer in time, so it reads a copy in localStorage —
   `bida.carry`, kept by `CarryToHomeScreen` in the layout, iOS tab only.
2. **The page URL, where it helps.** The banner still lands on `/install`
   with the same carry in the fragment, for an iOS that bookmarks the URL
   instead. It writes `bida.carry` first (`carryThenInstall`): the tutorial's
   head is built from it.

**A group joined or named after the page loaded** leaves its head stale, and
Safari won't read a swapped link. The link records what it was built with (`data-carry`); when that no
longer matches, `CarryToHomeScreen` reloads the page — on the first screen where
nothing can be lost (`reloadCostsNothing`: the list, a group, balances, members,
history, an entry, about), never mid-join or in a form, and never before the app shell is
precached (`shellIsWarm`, [pwa.md](pwa.md)). Unlike the
update's own reload, which on a ledger waits for a minute's absence, this one
fires as soon as the screen allows: a newcomer needs the new head now. From cache it is a flash, once; before the shell
is cached it would be a network load racing the worker's own fetches, so it
waits for the next reloadable screen.

**Every launch of the icon** (`app/install/page.tsx`) — `start_url` is this
route for the life of the bookmark, not just the first time. Its export is
the tutorial, which iOS paints before any script runs, so it also carries the
launch's own frames — "Joining…" for a newcomer's first launch, otherwise the
list or the group it will reopen — and a mark set before paint picks one
([frontend.md](frontend.md)). A key this phone lacks is
saved. A group the tab had named is claimed here, before its first sync — an
identity op of this app's own, since it is a device of its own, which history
reads as "Ana started editing from a new device". Nobody is asked who they are.
One group nobody has named is the newcomer, and goes to `/join`, which names
the group and waits out a first sync. What
the phone already holds is spent, so the icon is a door into the app rather
than into one group forever, and nothing un-forgets: `saveGroupKey` would undo
a `forgetGroup`, and a forgotten group's key is erased, so it is the id kept in
`leftGroups` that turns the carried key away. Everything but the newcomer is
then an ordinary launch: it says `launchedOnto` and the list reopens the group
you were last in as it would for any other start (`lib/launch.ts`) — on a first
launch there is none, so the list stays — which is the frame the mark picked:
the document never loads on the list here, so nothing about the address could
tell.

**What a real iPhone does**, against what WebKit's source suggests
(`WebPage::getApplicationManifest` walks the head when asked):

- A link swapped 41ms after load is ignored — the icon opens at `/`, the
  static `start_url`. Safari reads at load.
- With nothing in the HTML and the blob added at 45ms, the icon opens at
  `/install#<both groups>` and syncs both. The fragment survives. **It is the
  blob manifest that carries it**: an install from a group's ledger, a page
  whose own URL holds nothing, opens on `/install#…` with the group and the
  name in it.
- `start_url` must be absolute (a blob has no base), and `id` is pinned so it
  stays one app. Nothing bars a `blob:` manifest; the only gate would be CSP
  `manifest-src`, and this app sends none.

**Reading a run**: `/diag` in the tab and in the app. Each load line says which
manifest its head got (`static`, `carry:<n>`); the app's `first load` is the URL
the icon opened, and `install.app` what it did with it
([diag.md](diag.md)).

`pnpm verify homescreen` covers everything around that step in the engine that is
actually to hand ([browser-checks.md](browser-checks.md#pnpm-verify-homescreen--the-invite-that-rides-onto-the-home-screen)),
Android included: it must get the static `start_url: "/"`, since it shares
storage and needs none of this.

Consequences: a group joined *after* the install still comes in by Paste link.
Every secret the tab holds sits in its localStorage as well as IndexedDB, and
in the home-screen bookmark — all on the phone that already holds them.
If it doesn't, nothing is worse than before: the link is on the clipboard, and
the empty app's Paste link tile is where it goes.

## The design

Everything here is **iOS tab only** (`offerFrom` → `manual`) except the
in-app browser, which is every platform, and *where* the install card is drawn,
which Android shares — see [the card](#the-card--the-groups-list-and-the-ledger).
The home-screen app is otherwise unchanged. Wording is in `copy.install`,
`copy.claim.inApp` and `copy.embedded`.

### `/install` — the tutorial, shared

A route of its own, in `/about`'s register: short prose, one folded line, kept to the
few lines someone reads before they've decided this is worth their time. Every
"this browser" on these screens names Safari or Chrome when `iosBrowser` can
tell. It carries, in this order:

1. untitled — Safari may forget your groups after a week unopened; the invite
   link always brings them back. Then, for whoever wants to keep everything
   permanently, one bold line: add bida to your home screen.
2. a quiet line folded on every visit (no card), *Still seeing this after adding bida?*,
   above the clip, where the one who already added it finds it first: the
   tab can't see the app, and the two keep separate group lists from then on.
3. untitled — the two buttons in words (`copy.install.page.steps`: Share, then
   Add to home screen), each with the glyph iOS draws on it, then a
   recording of Safari's share sheet, which stops on the Add sheet: it never
   shows the tap on **Add**, or the icon arriving (`public/media/`, from
   `docs/media/safari-add-to-home-screen.mp4`; left out of the precache). The
   clip settles which button is meant faster than prose can — the sheet has
   moved between iOS versions — but it is silent to a screen reader and slow
   to a glance, so the steps lead and it confirms them.

Reached from the banner. Back is a plain back, and the only exit: the way
forward is out of the browser.

### The card — the groups list and the ledger

**One card, two bodies, the same two places on both platforms.** The shell is
`FoldedOffer` (`components/install.tsx`) and `offer` picks the body, so the two
platforms cannot drift apart in shape — the difference between them is in the
words and nowhere else:

- **iOS is a warning.** *Keep your groups on this phone / Safari may forget
  them*, with **Add bida to home screen** into `/install`, carrying every group
  in the tab.
- **Android is an offer.** *Keep bida on your home screen / Own icon, no browser
  bar, works offline*, with **Add**, which spends Chrome's captured prompt where
  it stands. There the tab and the installed app are one origin and one
  IndexedDB, so installing buys ergonomics and a reliable `persist()` — never a
  group back, and declining costs nothing.

Both scroll with what is under them; neither is pinned — pinned on the ledger,
the rows the screen is for would start a third of the way down.

**The groups list**, shown only once the tab holds a group. An empty home is
someone looking around: Quick split stores nothing and is the right way to try
bida, and a visitor won't install an app sight unseen. Once a group is in the
tab, "Safari may forget it" is true and worth saying at the top rather than the
foot. The fold is the device's and outlives the visit: a warning someone who
chose Safari can't put away is nagging.

**Each group's ledger**, above your balance, this group first in the carry —
folded on every visit and remembering nothing, since the entries are that
screen's job. Its fold is its own; the list's is the device's.

**Neither place asks about the demo.** It holds no key, so it is not among what
an icon would carry and there is nothing here a tab could lose — `/demo` lays
the story down again ([sync.md](sync.md#the-demo-group-has-no-key)). Its ledger
draws no card under the mark that says nothing here syncs, and a list holding
only the demo is still someone looking around, so it counts as no group to
lose. `pnpm verify homescreen` holds both.

Android is on the ledger for the same reason iOS is, and it is not about
eviction: `lib/launch.ts` reopens the group you were last in, and `/join`
pushes the group over the list, so the list is a screen most people never
linger on. Chrome's own mini-infobar is suppressed (`preventDefault`, so we can
draw the button ourselves), so without the ledger card the regular Android
user — joined by a link, launching straight into their group — would be offered
the install nowhere at all. It goes the moment the phone installs, since `offer`
stops being `ready`.

**Installed, the same card offers notifications** in the same two places
([notifications.md](notifications.md)) — *Notifications?*, with
**Choose**, since either answer clears it. The installed app is the only place iOS allows push, and its tap is
the only thing iOS lets ask for the permission. It stands until the prompt is
answered, since a refusal can't be asked again; the list's fold is its own
device field, as a tab and an installed app share one row on Android.

`/about`'s *Works offline* carries the same button on both, with no group
preferred first — `/install` says the how on iOS, and on Android the tap is the
install.

### `/g/claim` — *Have the app?*

`/join` asks nothing: an iOS tab joins and lands on "Which one are you?" like
any other browser. Pinned under the list, so a long one can't push it out of
sight, and hidden while a name is typed: a lower-contrast card, *Have the app?
Links always open in Safari. Paste this there instead.*, and the group's link in a box that
is its own copy button, reading **Copied** once a write has gone through —
tried on arrival too, though iOS only allows it inside a tap. No install ask
here; that is the banner's, once the tab holds a group.

It is for the regular, whom the tab cannot tell apart from a newcomer (H), so
it shows to everyone in a tab. A regular who picks a name in the tab anyway
has claimed twice.

### The in-app browser — a one-off visit

The app runs in a webview, under a banner atop every screen (`EmbeddedBanner`,
drawn by `Screen`): *One-off visit in Messenger's browser.*, folding open on
*We recommend opening in your main browser.* and the way there. What is done
there syncs like anywhere else; what is lost is the key on that webview, which
the invite in the chat still holds, and a second claim when the link is opened
properly — one more "started editing from a new device" in history. The
install and notification offers stand down there (`offerFrom` → `none`, since
a webview cannot install), so does the demo's card, which the banner already
covers, and so does the service worker, which would precache the app into a
storage nothing comes back to. Wording is in `copy.embedded`.

**The way out differs by platform.** Android takes **Open in browser**, an
`intent:` link the system hands to the default browser (`intentLink`): Android
reads the intent from the last `#`, so the page's own fragment rides in front
of it, never reaching a server. What rides there is an icon launch's carry,
`/handover#…` (`route.handover`): every key the webview holds and who it is in
each, the screen's group first. The tab it opens takes them as an icon would
(`useCarryIn`) and opens that group, nobody asked "Which one are you?" twice —
from a route of its own, since `/install`'s export is the tutorial, which
painted before any script and could stay. The address alone won't do — past the join it holds only the id,
and landed on "missing its password" — so the link waits for the keys' read.
That group alone un-forgets, its invite having just been tapped: a browser
that once forgot it would otherwise open it keyless, on the same screen.

iOS has no such link — no page can open Safari — so the fold names the button
instead: tap ⋯, then *Open in Safari*, which opens the address as it stands.
So in a webview **the address keeps the same carry** in its fragment, on every
screen but those whose fragment is their own (`KeepInAddress`), and a page
opened with one goes to `/handover` from the head, before it paints
(`handoverScript`). It rests on the host passing the address it shows, which
none is bound to. The price: the host's own *Copy link* now copies the keys
and who this phone is, and whoever opens it is claimed as that person.

**Detection is built to be wrong in one direction.** Catching a real browser
costs it the install offer and a banner that is wrong about it; letting a
webview through costs one confusing join. So a browser that names itself is
believed before anything else is read — which is what keeps Brave and
DuckDuckGo, whose agents are Safari's but for a token, out of it. Past that: a
named app (`Instagram`, `FBAN`…), Android's `; wv)`, or an iOS page with no
`Safari/` token. Chrome Custom Tabs carries no `wv` and is rightly let
through: it is Chrome, storage and menus and all.

`pnpm verify homescreen` drives both halves, the near misses included.

## Open questions for the owner

- Does **New group** in a tab want an ask of its own? Its key exists nowhere
  but that tab until the link is shared — worse than joining.
- Safari's "Add to Dock" web apps on a Mac have the same split storage and the
  same week; `looksIos` excludes a real Mac. In scope?

## Gotchas

- `looksIos` has to catch iPadOS, which calls itself a Mac
  ([lib/install.ts](../apps/web/lib/install.ts)), and an iOS home-screen app
  drops the `Safari/` token as a webview does — so `looksEmbedded` checks
  `standalone` first.
- The Add sheet's **Open as Web App** toggle is what makes an icon a web app.
  Off, it opens Safari and the install bought nothing; nothing can read it, so
  `isStandalone()` stays false and the banner rightly keeps warning.
- **`clipboard.readText()` draws its own Paste bubble, and the read that drew
  it can come back empty** (served from the pre-grant snapshot; a resume is the
  same). A second read is a second bubble, so one read decides and an empty one
  opens a box to paste into by hand
  ([lib/paste.ts](../apps/web/lib/paste.ts), `usePasteLink`).
- **A pasted join link is opened with `location.replace`.** When Next's router
  gives up and loads a page itself it uses the fetch's URL — no `#`, so "Bad
  link", and still ending in `.txt`, so a screen of RSC payload; `sw.js` and
  the Worker (`apps/api/src/payload.ts`) redirect that back to the route. Not
  `assign`: the page left behind sits in WebKit's page cache holding the
  database `/join` waits on.
- **Safari reads the manifest at page load**, so the HTML carries no link: a
  script at the head writes it, and a page whose carry changed reloads once the
  shell is cached. Leave `manifest` out of Next's metadata, which re-inserts its
  own link after hydration.
