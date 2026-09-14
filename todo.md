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

### Before advertising: the scan endpoint

- [x] The Worker owns the prompt, so the key relays receipts and nothing else.
- [x] A budget — per caller, per address, and a global daily cap that is the
      one number bounding the bill — plus Turnstile in front of every scan.
      [docs/receipt-scanning.md](docs/receipt-scanning.md#what-the-scan-costs).
- [ ] **The owner still has to turn it on**: create the Turnstile widget, set
      `TURNSTILE_SITE_KEY` (repo variable) and the two Worker secrets, and set
      a hard project quota in Google AI Studio just above the global cap.
- [ ] The same door still writes unbounded ops into a D1 that may never be
      wiped again. `POST /ops` has no budget and registers any unseen id;
      giving credential-minting its own door is the shape of that fix.

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