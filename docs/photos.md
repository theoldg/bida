# Kept receipt photos

*For: anyone touching an entry's photo, its storage, or its budget.*

An expense keeps one photo: the cropped, straightened JPEG its last photo
scan read (≤1 MP, ~40–150 KB). Only a scan sets it — nothing attaches a picture
by hand or clears one. The entry form's photo row, there only with a photo,
is its square miniature, unlabelled, and what Save keeps. On the entry the miniature
sits beside the title, and a tap opens it whole: at the screen's width,
pinched, dragged and flung by hand (the app turns the browser's zoom off) under
a cross that stays put, and a tap puts it away. `/diag/crop` opens its images
in the same viewer. Every phone in the group sees it; the server can't
([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)).

## What is stored where

| | Where | What |
|---|---|---|
| `attachment` entity | the op log, like any entity | `expenseId`, `mime`, `bytes`, `createdAt`, `deletedAt` — that a photo exists |
| `expense.attachmentIds` | the entry's own op | `[id]` while kept, `null` once not. One photo per entry |
| the bytes | R2 `hajsik-photos` (dev `hajsik-photos-dev`), key `<groupId>/<id>` | sealed under the group's content key, the AAD `photo\n<group>\n<id>` (`sealPhoto`) |
| `photos` (D1) | beside the ops | one row per object: group, id, sealed size — for deletion and the budget |
| `photo_usage` (D1) | | `stored` (bytes held) and `writes:YYYY-MM` |
| `photos` (Dexie) | this phone only | the plain JPEG and what it owes the server: `upload`, `held`, `delete` |

The attachment's ops are **quiet** (`isQuiet`): the history narrates the entry's
`attachmentIds` moving — "added a photo", "removed a photo", "replaced the
photo" — never the attachment's own create.

## Saving and rescanning

The save decides (`photoChange` in the form, `PhotoChange` in
`commands/entries.ts`), in one `appendOps` with the entry's op:

- **A photo just scanned** → a new attachment replaces whatever was kept. The
  old one gets a `delete` op and its bytes are queued to drop.
- **An income** → none kept. An income has no bill, so the row is
  hidden there and the photo drops with the scan; switching back before saving
  brings it back, since only Save decides.
- **The entry's own photo, still shown** → left alone.

So a successful photo scan replaces the photo; a refused scan, a bill typed by
hand and a tab change leave it. Deleting the entry keeps the
attachment, since the entry can be restored. A group's deletion
(`DELETE /api/groups/:id`) takes every photo with it, found by the D1 index.

## Sync

After the ops (`syncPhotos` in `lib/db/sync.ts`): the op push registers a new
group, and a photo nobody's op names is useless. Uploads go before deletes, so a
replacement lands before the photo it replaces goes. **Photos never fail a
sync** — the ledger doesn't wait on a picture.

Another phone fetches a photo the first time a screen draws it (`usePhoto`),
opens it and keeps it; until then the miniature is an empty frame. A 404 (not
uploaded yet) is asked again after a minute. A pull that brings an attachment's
`delete` drops the bytes here too. The demo has no key, so its photos never
leave the phone.

| Answer | The phone |
|---|---|
| 200 | `held` (or, for a delete, forgets the row; a 404 counts) |
| 503 `off` — no bucket bound, or no tables | asks again in an hour |
| 507 `group` · `storage` · `month` | asks again in six hours; the photo stays on this phone meanwhile |
| 413, 400 | never again: `stuck`, on this phone only |
| 410 | the group was deleted; the op sync erases it |

## The budget

R2 bills past its free tier — 10 GB stored, 1M writes and 10M reads a month,
**per account**, so dev and production share it. `apps/api/src/photos.ts`
refuses before the bucket is touched:

| Ceiling | Production | Dev |
|---|---|---|
| Sealed bytes held | 8 GB | 1 GB |
| Uploads a calendar month (UTC) | 800k | 100k |
| One group's bytes | 100 MB | 100 MB |
| One upload | `MAX_PHOTO_SEALED`, 512 KB | same |

Each counter moves only if it stays under its ceiling, in one statement, so a
race can't take the last room twice; a booking whose upload fails is handed
back, and a second upload of a stored photo spends nothing. **Reads aren't
counted**: a read is one Worker request, the free plan stops at 100k a day,
and a month of those is ~3.1M, under the 10M. Deletes are free; listing the
bucket is a paid write, so nothing lists it. None of this counts a person —
the counters are global and the index is per group, as the ops are
([standing-instructions](standing-instructions.md#product)).

## Gotchas

- **A binding to a bucket that doesn't exist fails the deploy.** Both buckets
  exist; a new environment needs its own before `wrangler.toml` names it, and
  the token needs *Workers R2 Storage: Edit*.
- **Don't freeze bytes in Dexie.** The tables are read with `cache: "immutable"`,
  which freezes rows, and a typed array with elements can't be frozen: the JPEG
  is kept as base64.
