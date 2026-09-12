# TODO

## Release

### Self-hosting instructions

### Other cleanups

Check for secrets, license, data disclaimer, other?

### Admin panel?

### Assess privacy

**Answered, and the answer is bad:** ops land in D1 as plain JSON. The group
secret is only a bearer token, stored as a SHA-256 hash (`apps/api/src/auth.ts`,
`store.ts`), so anyone with database access reads every title, amount, name and
note. Decide: say so plainly in the disclaimer, or encrypt the op payload under
a key derived from the link secret. The second is the biggest piece of work
left in the project — see the note at the foot of this file.

### paying for the Gemini API

Invent an option to record a donation as a shared expense with a special look. "thanks bida!" or "the group liked bida".

Figure out some payment integrator to use.

### About/feedback/privacy

**Built** — `/about`, off the "About bida" line at the foot of the groups list.
It says what the app is, that a group is a link, that the phone holds it, what
the server can see, and where to write. Rewrite its privacy paragraph the day
[Assess privacy](#assess-privacy) is answered with code rather than with prose.


## Features

### Entry search and sorting

Maybe? Low priority. Needed together with variable exchange rates for the "super long running group" use case.

## UX improvements

### Who had what
- Include non-translated mode
- Language choice should reflect on the expense summary outside of edit mode?

## Engineering

### End-to-end encryption (the hard one)
See [Assess privacy](#assess-privacy). Encrypting op payloads under a key
derived from the link secret keeps the server honest, but it costs the server
every ability that depends on reading content, needs a migration for groups
already in D1, and has to survive a link shared by someone who then changes
nothing. An ADR before a line of code.
