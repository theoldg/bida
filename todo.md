# TODO

## Release

### Self-hosting instructions

### Other cleanups

Check for secrets, license, data disclaimer, other?

### Admin panel?

### Assess privacy

**Answered in code** (2026-09-12): op bodies are sealed under a key derived from
the link secret, which the server never receives
([ADR-0036](docs/decisions/0036-the-server-cannot-read-a-group.md)). What is
left to decide is whether the receipt scan — the one thing that still leaves in
the clear, to Google — is worth keeping on those terms.

### paying for the Gemini API

Invent an option to record a donation as a shared expense with a special look. "thanks bida!" or "the group liked bida".

Figure out some payment integrator to use.

### About/feedback/privacy

**Built** — `/about`, off the "About bida" line at the foot of the groups list.
It says what the app is, that a group is a link, that the phone holds it, what
the server can see, and where to write.


## Features

### Entry search and sorting

Maybe? Low priority. Needed together with variable exchange rates for the "super long running group" use case.

## UX improvements

### Who had what
- Include non-translated mode
- Language choice should reflect on the expense summary outside of edit mode?

## Engineering

### End-to-end encryption
**Done** (2026-09-12) —
[ADR-0036](docs/decisions/0036-the-server-cannot-read-a-group.md).
