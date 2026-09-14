-- What the scan endpoint has spent, and on whose behalf. See
-- docs/receipt-scanning.md#what-the-scan-costs — this file must stay identical
-- to the SQL block there.
--
-- One row per scan, pruned at 24h, and that horizon is the whole design: every
-- window we enforce is an hour or a day, so a row older than a day can answer
-- no question. Nothing here says what was photographed — only that somebody
-- spent a call.

CREATE TABLE scan_hits (
  at      INTEGER NOT NULL,   -- ms, our clock
  caller  TEXT NOT NULL,      -- the :id in the path: a group, or a phone's scan credential
  client  TEXT NOT NULL       -- HMAC(cf-connecting-ip, SCAN_IP_SALT), 16 hex — never the address
);

-- The only index worth keeping: every read is "the last hour" or "the last
-- day", both of which start by narrowing on `at` to at most a day's rows.
CREATE INDEX scan_hits_at ON scan_hits(at);
