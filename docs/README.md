# Docs

Read what your task needs. Each doc says at the top who it's for, and a subject
with several docs has a parent (the unindented row) whose own table says which
of its children your task needs — read the parent's head, then one child. Keep
them tight — see [CLAUDE.md's doc upkeep rules](../CLAUDE.md#doc-upkeep).

| Doc | Read it when |
|---|---|
| [standing-instructions.md](standing-instructions.md) | **First.** The owner's rules for how this project is run |
| [implementation-status.md](implementation-status.md) | **Starting a session.** What's built and what's next |
| [invariants.md](invariants.md) | You are adding a check that reads other entities, or touching member identity |
| [product.md](product.md) | Deciding whether something is in scope |
| [architecture.md](architecture.md) | Touching the shape of the system |
| [data-model.md](data-model.md) | Touching entities, money, splits, or the D1 schema |
| [sync.md](sync.md) | Touching the op log, offline behaviour, or history |
| [frontend.md](frontend.md) | Writing UI: forms, drafts, copy, money fields — then one of: |
| ↳ [navigation.md](navigation.md) | Routes, links, and the back button |
| ↳ [touch-and-viewport.md](touch-and-viewport.md) | Presses, holds, dialogs, the keyboard, the height of the screen |
| ↳ [live-reads.md](live-reads.md) | Reading from Dexie, or a screen stuck on its skeleton |
| ↳ [pwa.md](pwa.md) | The manifest, the service worker, updates, installing |
| ↳ [import-export.md](import-export.md) | Import, export, deleting a group, the clipboard |
| ↳ [diag.md](diag.md) | `/diag`, the flight recorder |
| [ios.md](ios.md) | Touching joining, installing or storage on iPhone |
| [notifications.md](notifications.md) | Push notifications: what is said, and how it is kept, sent and shown |
| [receipt-scanning.md](receipt-scanning.md) | Touching the receipt scan: how one starts, the typed bill — then one of: |
| ↳ [scan-reading.md](scan-reading.md) | The prompt, and what the app does with a reading |
| ↳ [who-had-what.md](who-had-what.md) | The grid a bill is divided on; tip, tax and discounts |
| ↳ [scan-worker.md](scan-worker.md) | The shared key, the envelope, the budget, Turnstile, trust |
| [design-system.md](design-system.md) | Writing anything a person will look at |
| [hosting.md](hosting.md) | Deploying, or worrying about cost |
| [testing.md](testing.md) | Running the gate or writing a unit test — then one of: |
| ↳ [browser-checks.md](browser-checks.md) | Writing, fixing or reading a browser check |
| ↳ [shots.md](shots.md) | Photographing screens, and the README's pictures |
| ↳ [on-a-phone.md](on-a-phone.md) | An iPhone in hand: what no headless browser can check |
| [drive.md](drive.md) | Reproducing a bug or stressing a screen without a phone |
| [decisions/](decisions/README.md) | About to reverse an architectural choice |
| [claude_corner.md](claude_corner.md) | **Every session, briefly.** How the owner asks, and what agents get wrong here |

Most docs end with a **Gotchas** section. Add to it every time something bites
you, so nobody pays for it twice.
