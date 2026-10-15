# Browser checks: storage and updates

*For: anyone fixing or extending the checks on storage and updates: the network
cut, a deploy, a database that stops answering. Part of the [browser
checks](browser-checks.md) docs, which say how to write one that holds.*

## `pnpm verify offline` — the built app with the network cut

An offline-first data layer is not enough: if the precache misses the payloads
Next fetches on every tap, a phone with no signal gets a wall of
`1:"$Sreact.fragment"`. So this seeds a group online, lets the service worker
install, pulls the plug, and walks every screen, saving an expense on the way
([pwa.md](pwa.md)) — before the plug, an invite's page must come from the
server and not the cache, and after it, from the cache. Then the deploys, on levers the server holds: one arriving
over a dying signal with an asset missing must fail to install rather than
activate with holes; one arriving by itself is taken at once only by a page
untouched on the groups list — a page in use is offered the reload, an
untouched group stays put, and a resumed one reloads only after a long absence,
played out by moving the page's clock; a second deploy must not delete the
cache a page that never reloaded still runs on; and a page whose build has left
the cache is refused a stranger's payload and keeps its `?id=`.

## `pnpm verify stall` — a read of this phone's database that dies

It holds the defect no screen can report: an installed Android app hanging on
its skeleton rows, indefinitely, with nothing in the console
([live-reads.md](live-reads.md#a-live-read-can-die)).

`indexedDB.open` is stubbed to return a request that never fires an event —
what a wedged backing store or a blocked upgrade does, and what nothing in
Dexie times out against. The skeleton is expected, and then the notice over it
is. Measured against the app with the watchdog taken out, the second assertion
fails, which is what makes it a check rather than a screenshot.

It also opens `/diag` while the database is still wedged and fails unless the
readout names what never came back. A diagnostics screen that hangs on the
fault it reports is worse than none.

Then the database is deleted from another connection — a browser reclaiming
storage, from inside the page. A smoke test, for the property (a forced close
must not strand the app on rows no longer there), not the mechanism: it passes
with the `close` handler removed too.

Then a second tab holds a readwrite transaction open over every store — the
lock a frozen copy keeps. A screen already read must show its remembered
answer rather than skeleton rows (it fails with that taken out), the notice
must still stand and then leave once the lock goes, and `/diag` must list the
other copy.

Last, the other side of that: this copy must never be the one holding it. A
page told it is hidden opens a group, and the `device` write that navigation
makes must not land until the page is seen again — it fails both ways with the
gate taken out (`lib/db/visible.ts`). Headless Chromium calls every page
visible however the tabs are arranged, so `visibilityState` is overridden in
the page rather than a second tab brought forward; the navigation it lies to is
a real one.
