# TODO

## Release

### Self-hosting instructions

- [x] [SELFHOSTING.md](SELFHOSTING.md) — deploy, CI token, the scan proxy caveat,
      local dev, renaming.

### Other cleanups

- [x] Secrets — the full history greps clean for key and token shapes;
      `.gitignore` covers `.dev.vars`, `.env*`, `.wrangler/`.
- [x] Licence — MIT, with the name and the logo held back (README).
- [ ] Data disclaimer — `/about` already says what the server sees and names
      the scan as the exception. Missing: a liability line for the hosted
      service, and any way at all to ask for a group to be deleted.

### Before advertising: the scan endpoint is an open proxy

`ensureGroup` registers any unseen id under whatever bearer arrives — by
design, it is how a quick split mints its credential (`lib/quick.ts`) — so two
unauthenticated requests reach `/scan` and spend the Gemini key. And the client
builds the whole Gemini body, so what is on offer is any prompt, not just
receipts. The same door writes unbounded ops into a D1 that may never be wiped
again, and nothing anywhere is rate-limited.

The shape of the fix: move the prompt to the Worker (splice it around the image
stream, so the CPU budget survives), a rate-limit binding per credential and
per IP, a daily cap that 404s the way the button already expects, and give
credential-minting its own door so throttling it doesn't throttle sync.

### Admin panel?

### paying for the Gemini API

Invent an option to record a donation as a shared expense with a special look. "thanks bida!" or "the group liked bida".

Figure out some payment integrator to use.

### dev environment


## Features

### Entry search and sorting

Maybe? Low priority. Needed together with variable exchange rates for the "super long running group" use case.

## UX improvements

### Who had what
- Include non-translated mode
- Language choice should reflect on the expense summary outside of edit mode?