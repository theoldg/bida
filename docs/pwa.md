# PWA

*For: anyone touching the manifest, `sw.js`, updates or installing. Part of the
[frontend](frontend.md) docs; why cache-first is safe is
[ADR-0004](decisions/0004-static-export-and-offline.md), and the iPhone's
half — a tab and a home-screen app that share nothing — is [ios.md](ios.md).*

`public/manifest.webmanifest` is linked by a script at the top of `app/layout.tsx`'s head, not by metadata — an iOS tab gets a different one there ([ios.md](ios.md#a-in-detail)): maskable icons,
`display: standalone`, and one ink `theme_color`/`background_color` — the
status bar and the splash screen, which is why they are ink rather than paper
and why `viewport.themeColor` repeats the same value rather than tracking the
theme (Gotcha below). The
three PNGs are rasterised from `design/brand/logo.svg` by `pnpm icons`, which
also copies that file to `public/logo.svg` for the top-bar mark to point at —
run it when the logo changes rather than editing any of the four (or the
notification badge it also draws, [notifications.md](notifications.md#gotchas)); the maskable
one draws the receipt at 72%, because a launcher crops to the central 80% and
the artwork as drawn crowded that circle's rim. The same run draws
`public/og.png`, the 1200×630 banner a pasted link shows, from
`design/brand/banner.svg` in the export's own JetBrains Mono — so it builds the
export first; the precache leaves the banner out. iOS ignores
manifest `display` entirely; `appleWebApp.statusBarStyle` is its lever, and it
is `"default"` so the page starts below the status bar (Gotcha below). The strip
that leaves above the page is painted from **body's background**, so at phone
width body wears the shell's own `--card` (the dev build, its green bar): iOS 26
lays a scrim under the status bar, and a seam there is an edge for it to reveal
(Gotcha below).
`viewport-fit: cover` stays for the home indicator and a landscape notch, which
is why the `env(safe-area-inset-*)` padding matters.

Installing is also what makes the browser grant `navigator.storage.persist()`
(`lib/persist.ts`, called from `saveGroupKey` and on every start once the phone
holds a group, because the answer changes once the app looks established).
Without it IndexedDB is evictable ([architecture.md](architecture.md#gotchas)),
so the app asks to be installed too. `lib/install.ts` captures
`beforeinstallprompt` at module load — it fires once, early, and only that
object can open the install sheet later — and reduces the situation to
`installed | ready | manual | none`; iOS has no such event, hence `manual`.
`components/install.tsx` puts one card atop the groups list
(`InstallOfferCard`), only once there is a group worth coming back to: Chrome's
prompt on the `ready` branch, the iOS warning linking to `/install` on `manual`
— the seven days are WebKit's, every iOS browser is one, and a warning that true
belongs first ([ios.md](ios.md)) — and, once `installed`, the notifications
offer in its place. **It folds, it does not dismiss** — persisting storage is
worth the standing ask, and installing is what ends it. The title is its
disclosure, and `installNudgeCollapsed` (or `notifyNudgeCollapsed`) on the
device record remembers the fold. The same card sits atop each real group's
ledger (`LedgerInstall`), folded on every visit and remembering nothing.

**A link to this app is nearly always sent in a chat**, so `metadata` in the
layout also carries Open Graph and Twitter tags for the card a chat app draws,
built by `lib/preview.ts`. They are static and say nothing about the group,
which they could not anyway: the secret is in the fragment and never leaves the
phone. `/join`, where every invite lands, swaps only the card's title for
`copy.app.invite` — the banner already says the name — and keeps "bida" in the
tab. `metadataBase` is pinned to
`https://bida.bid` because a crawler has no page to resolve a relative URL
against and the build is byte-identical on both Workers
([hosting.md](hosting.md#dev-and-production)). **There must be no `og:url`** —
as a root-level default every route claims to be the site root, and Messenger
on iOS then delivers an invite as the bare origin, path and fragment gone.
Left out, a scraper uses the URL it fetched.

`public/sw.js` precaches the whole export — routes, hashed `/_next/static/`
chunks, *and* the `.txt` RSC payloads Next fetches on every in-app tap —
registered from `components/register-sw.tsx`. **It does not cache `/api/*`** —
Dexie is the offline data layer, and a second cache over the same data gives
you two disagreeing sources of truth.

**A payload URL asked for as a *page* is redirected to the page.** When the
router's fetch of `/g/claim.txt?id=…` fails, Next hands that URL to the browser
as a plain navigation — and served literally it is a screenful of
`1:"$Sreact.fragment"` where a screen should be. `sw.js` redirects those back to
the route, carrying the `?id=` and dropping `_rsc`. A redirect, not the route's
shell served in place: the app runs at the address it was asked for, and
`/g.txt` is not a route — back arrows are paths (`lib/nav.ts`), and so is
`reloadCostsNothing`. So does the Worker (`apps/api/src/payload.ts`), because a
service worker only sees a page it controls and this one does not claim a first
visit: the iPhone that has just tapped an invite is on its first load, has no
worker yet, and is on its way to `/g/claim`
([ios.md](ios.md), [hosting.md](hosting.md#deploying)). The two hold one rule —
nothing else in the export ends in `.txt` — so a real `.txt` asset would need a
carve-out in both.

Everything precached is served cache-first, so a launch and every tap after it
paint without waiting on the network. The list and the cache name are stamped in
after the build by `apps/web/scripts/precache.mjs` — nothing to drift, no
`CACHE_VERSION` to bump. A new build copies each `/_next/static/` file an
earlier one already cached (the name is the content) and fetches only the rest:
routes and payloads name the build, so they always are. The three things that
make cache-first safe are [ADR-0004](decisions/0004-static-export-and-offline.md). Run `node
scripts/checks/offline.mjs` after touching either file: it walks every screen
with the network cut, then installs a deploy over a half-dead network, and a good one
across three open pages.

**A new build is taken as soon as it is safe, by itself.** `sw.js` calls
`skipWaiting` the moment the whole build is precached, rather than waiting for
the last client of the origin to close — on iOS Safari tabs and the browser
outlive what a person thinks of as quitting. `activate` writes down **which build each open
window is running** (in memory and in the `bida-legacy` cache, since the browser
stops idle workers) and keeps every cache still spoken for: those pages go on
being served their own build, so their next tap can't mix an old router with a
new payload. A cache nothing is on is deleted — never `bida-pull`, which is data rather than a build ([sync.md](sync.md#the-pull-ahead)) — so the cost is one kept shell per
window somebody left open, and a window that closes takes its cache with it.
Keeping only the newest other cache is not enough: two deploys later a page
further back is served a stranger's `/g.txt`.

Every window open when `activate` runs is written down, because none of them can
be on this build — which build they *are* on is the guess, and `null` is the
honest answer when nothing can answer for one: a cache evicted under it, or a
first build with nothing before it. Such a window is then **refused a payload**
rather than handed this build's. Next answers a build id that is not its own by
navigating to the *response's* URL, and a response out of a cache carries its
cache key, which for a payload is a bare path — one file answers every `?id=` —
so the group id is lost on the way. Refused, the router falls back to the URL
*it* asked for, and the redirect above turns that back into the route; the cost
is that the window's next tap is a full load rather than a routed one (Gotcha
below).

**The app reloads itself onto a new build where nothing can be lost, never
mid-use.** `lib/update.ts` hears `controllerchange`: on the groups list,
untouched, it reloads at once; otherwise it waits for the app to come back to
the front (`mayReloadOnReturn`, never while hidden) — onto the list after any
absence, onto any other `reloadCostsNothing` screen (a ledger, balances…) only
after a minute away (`AWAY_MS`). A reload in the installed app is a relaunch,
splash and all: after a quick app switch, on a ledger, it reads as a crash;
after a minute it reads as having left. The list alone was too rare a door —
launches resume the last group (`lib/launch.ts`). On the two forms a reload
would throw away a draft that lives only in memory (`lib/draft.ts`), and on a
flow drop a step, so never there; nor anywhere while the screen is holding
something — an open dialog, a half-typed name, a search (`useHoldsWork`).
`reloadCostsNothing` is the one list of screens that hold
nothing only this page has, and the iOS carry reload — which cannot wait for a
list a newcomer never passes — is its other caller ([ios.md](ios.md#a-in-detail)).
`lib/update.ts` also re-checks `sw.js` on every resume (an installed app is
resumed far more often than it is launched) and records when
`navigator.serviceWorker.ready` resolves (`shellIsWarm`) — the only flag that
says the precache is done, since a worker that never claims a first visit leaves
`controller` null for the whole of that page's life. In between, **Settings › Version** shows the build and, when a
newer one is waiting, a Reload (`app/settings`) — no card anywhere else. `checks/offline` holds pages open across a
deploy: untouched, in use, and on a group through a quick and a long absence.

## Gotchas

- **A cached response's URL is its cache key, not what was asked for.** Next
  reads `res.url` off a payload from another build and navigates there, so a
  precached payload sends a phone to a `/g` with no group. Every payload goes
  out as a constructed response (`asAsked`), which reads as the request's URL.
- **A waiting service worker waits on the whole origin.** One forgotten tab
  pins the old build — on iOS even past killing the browser — while incognito
  shows the new one. That is why the worker does not wait.
- **`caches.match` searches every cache in the origin**, and `controllerchange`
  fires before the new worker's `activate` deletes the old one, so an unscoped
  read serves the reload an old shell. Every read goes through `lookup()`;
  `checks/offline` plants a stray cache and fails on anything but a 404.
- **A page left on the old build breaks on its next tap**: Next refuses the new
  build's `/g.txt` and navigates to the bare route, dropping the group id.
  `sw.js` serves such a page its own build's cache until it reloads
  (`previousFor`).
- **An installed Android app's status bar is the manifest's `theme_color`,
  fixed at install**; `<meta name="theme-color">` only picks the icons' contrast
  over it. Adaptive tags give white icons on a paper bar, hence one colour, ink,
  in both. To tell layers apart, give each a unique colour and reinstall.
- **Never `black-translucent` on iOS 26** (WebKit bug 301108): an unreachable
  strip at the foot and a blur over the top bar. `"default"` avoids both.
- **iOS 26 dims the top of the page under the status bar, always.** What is
  ours is what it falls on: match body's background to the bar at phone width
  (`.app`), or the scrim reads as a band.
