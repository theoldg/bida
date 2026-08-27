# Hajsik

*"a bit of cash"*

A Tricount-style shared expense splitter, built as a mobile web app / PWA.
Works offline, keeps a full edit history, holds several receipt photos per
expense, and can show you the whole ledger through a personal lens.

Personal project. Very few users. Runs entirely on free hosting tiers.

**Design mockups:** [signed off, 2026-08-27](https://claude.ai/code/artifact/5195880f-3985-4409-ac1a-854e5a756921)
· source in [`design/mockups/`](design/mockups/)

**If you are a coding agent, read [CLAUDE.md](CLAUDE.md) first.**
Everything else lives in [`docs/`](docs/README.md).

**Live at <https://hajsik.hajsik-api.workers.dev>.**

## Status

The MVP (Phases 0-3) is complete and deployed: local-first app, full domain
logic, and server sync all working. See [docs/roadmap.md](docs/roadmap.md)
and [docs/implementation-status.md](docs/implementation-status.md).

## Stack

Next.js (static export) · hand-rolled components, no UI library ([why](docs/decisions/0008-hand-rolled-css-not-shadcn.md))
· Tailwind · Dexie/IndexedDB · Cloudflare Workers · D1 · R2 (not yet wired up)
