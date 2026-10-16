# Browser checks: the ways in

*For: anyone fixing or extending the checks on the ways into a group: an
invite, the home-screen icon, the in-app browser's way out, the demo. Part of
the [browser checks](browser-checks.md) docs, which say how to write one that
holds.*

## `pnpm verify join` — every way in, across a full load

The ways into a group, on the real Worker and D1, with **every in-app tap made
a full page load** — what the first tap after a deploy is, since Next loads a
payload from another build itself. Whatever a hand-off kept anywhere but the
address is gone by the next screen, so this is where that shows
([navigation.md](navigation.md#gotchas)). A newcomer's invite lands on "who are
you" and answering opens the group; the same invite, from a phone last in
another group, opens that group and not the list, and its back arrow climbs to
the list; and an in-app browser that answered "who are you", opened in a
browser by its address or by the link it shows, lands in the group as the same
member, never asked again. It failed all three ways on the hand-off it
replaced. That the invite's page comes fresh from the server while online is
`pnpm verify offline`'s.

## `pnpm verify homescreen` — the invite that rides onto the home screen

One step of this cannot be checked anywhere but an iPhone: which URL WebKit
writes into the bookmark when someone taps Add to Home Screen
([ios.md](ios.md#a-in-detail)). Everything on either side of
that step can be, and all of it looks fine in jsdom — so the check wears an
iPhone's user agent and drives both ends.

The tab end: a join that is not stopped to ask about installing; no page's
HTML carrying a manifest; the banner — on the groups list, and at a ledger's head — the first landing on a `/install` whose
fragment is every group the tab holds and who it is in each, the top of the
list first; the claim list's "Have the app?" card holding the group's link;
every page's head — `/`, a group, its members, not only the tutorial — holding
exactly one manifest, a `blob:` whose `start_url` is `/install#` those same
groups and whose URLs are all absolute (a blob has no base to resolve a
relative one against); and a browser that installs by itself — Android — given
the one static manifest.

It also asks Chromium's own install machinery what it would take, over CDP's
`Page.getAppManifest` — the same question Safari asks WebKit when the share
sheet opens, and it is answered from the DOM as it stands rather than from what
was in the head at load. Chromium is not WebKit and cannot say what iOS
bookmarks, but it is a second implementation of the same parse and the only one
that can be run here. A deliberately relative `start_url` follows, and must come
back refused: every URL in a blob manifest has to be absolute, because a blob
has no base to resolve against, and that is the one mistake this approach
invites — without that control the green above would mean nothing.

**A head that predates a change** is checked as a pair, because the reload that
mends it is gated on the shell being precached ([ios.md](ios.md#a-in-detail)):
a warm phone's stale head is mended by a row tap on the list, and a phone with
no service worker at all — a first visit, mid-precache — keeps its stale head
through the same tap. Both count document requests, and the move is a row tap
rather than the back arrow on purpose: the arrow *traverses* (`lib/nav.ts`),
and a cross-document traversal rebuilds the head by itself, which would pass
with the reload switched off. The one traversal that keeps its head is Back
onto a page restored from the page cache, which Playwright switches off and
`launch({ bfcache: true })` turns back on: a list left for a new group must
reload there and stay the list, not reopen the group as a launch would.

The app end (`asInstalledApp`): a launch on one invite nobody has named hands
it to `/join`; a launch whose secrets are already on the phone doesn't — the
icon is a door into the app, not into one group forever; one carrying several
saves them all, lands on the list and has claimed the member the tab was in
each; and one named group skips `/join` and is claimed too. The keys and names
are read out of IndexedDB rather than off a screen: no sync API stands behind
this check, so a group whose key just arrived has no ops to draw a row with —
which is also the slow phone's first launch held still, where the list must
say it is fetching them rather than that there are none. Every frame of three
launches — the newcomer's, a reopen, several groups — is sampled from the
first: none may show the tutorial (`/install` is its route too), no screen at
all, or a pressable control while `/install` stands in; the newcomer and the
reopen never show the list either.

**The in-app browser**, last: a webview joins under a banner naming the app,
unfolding to the menu to tap and the link to paste as text (iOS) or an
`intent:` link (Android), each carrying the screen's group — every group
from the list — and who it is in each, which a tab opens straight into; a
quick split's link draws none and keeps its own fragment. Then the half that matters more: the
home-screen app, Brave and DuckDuckGo each draw *no* banner
([ios.md](ios.md#the-in-app-browser--a-one-off-visit)).

It needs no server beyond the static export: what it asserts is which URL each end reaches.

## `pnpm verify demo` — the demo group, and the key it must not have

The seed's arithmetic is core's own (`demo.test.ts`: the balances clear to zero
under `settle`, every amount is a positive integer minor unit, any permutation
folds identically). What this check asks is what the seed cannot: that
`/demo` first asks which of the four you are — nobody preselected — and the
answer lands on a populated ledger rather than an empty state, that the balances do not cancel, that the mark is at its head, that the
cantina tab opens onto the bill it was itemised from, that **Copy invite link**
refuses out loud, that an entry added there is not "waiting" offline, and that
clearing a demo somebody has added an entry to takes the whole group off the phone while the address lays the shipped story
down again — entry for entry, and without the one that was added. A demo
address copied from any `/g` screen opens the demo on a second, fresh phone
rather than "bad link", and does not re-seed it on the phone that cleared it;
a cleared demo asks again who you are, a re-seeded one keeps the answer — unless
it named someone the visitor added, whom the new story lacks. The dialog
that offers it has to name this server's own `/demo`, host and all: the host is
the browser's to supply, so an unwired one would read as a bare path.

It then says this phone holds an older build's seed — a `demoSeed` of its own
invention, written straight into the device record — and reopens the address,
which has to erase what is there and write the new story rather than hand back
the old one ([navigation.md](navigation.md#routing)). The visit after that must
rewrite nothing: a re-seed on every open would throw away a demo somebody was
still reading.

It also photographs a receipt there, with the network watched: the demo scans
under this phone's own credential, and its own id must appear in no request at
all ([sync.md](sync.md#the-demo-group-has-no-key)).

It also sits on the ledger for fourteen seconds and asks for the stall notice,
which costs the check its slowest assertion and is worth it: a group with no
key row is the demo's defining property, and a read answering `undefined` for
it would raise the notice over a drawn screen
([live-reads.md](live-reads.md#a-live-read-can-die)).

The assertion worth having is the quiet one: `groupKeys` stays empty
([sync.md](sync.md#the-demo-group-has-no-key)). A key row there is the single
change that would start pushing tourists into a D1 that gets no further resets,
and nothing else would notice, because the demo would carry on looking perfect.
