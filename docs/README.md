# Docs

Read what your task needs. Each doc says at the top who it's for. Keep them
tight — see [CLAUDE.md's doc upkeep rules](../CLAUDE.md#doc-upkeep).

| Doc | Read it when |
|---|---|
| [standing-instructions.md](standing-instructions.md) | **First.** The owner's rules for how this project is run |
| [implementation-status.md](implementation-status.md) | **Starting a session.** What's built and what's next |
| [invariants.md](invariants.md) | You are adding a check that reads other entities, or touching member identity |
| [product.md](product.md) | Deciding whether something is in scope |
| [architecture.md](architecture.md) | Touching the shape of the system |
| [data-model.md](data-model.md) | Touching entities, money, splits, or the D1 schema |
| [sync.md](sync.md) | Touching the op log, offline behaviour, or history |
| [frontend.md](frontend.md) | Writing UI, routing, or PWA code |
| [ios.md](ios.md) | Touching joining, installing or storage on iPhone |
| [notifications.md](notifications.md) | Push notifications: what is said, and how it is kept, sent and shown |
| [receipt-scanning.md](receipt-scanning.md) | Touching the receipt scan or its Gemini call |
| [design-system.md](design-system.md) | Writing anything a person will look at |
| [hosting.md](hosting.md) | Deploying, or worrying about cost |
| [testing.md](testing.md) | Writing tests or reviewing screens |
| [drive.md](drive.md) | Reproducing a bug or stressing a screen without a phone |
| [decisions/](decisions/README.md) | About to reverse an architectural choice |
| [claude_corner.md](claude_corner.md) | **Every session, briefly.** How the owner asks, and what agents get wrong here |

Most docs end with a **Gotchas** section. Add to it every time something bites
you, so nobody pays for it twice.
