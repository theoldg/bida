-- A quick split handed over as a link. See
-- docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md — the SQL block
-- in docs/data-model.md#d1-schema says the same.
--
-- The link's secret never arrives: the id and the token are both derived from
-- it, and the body is sealed under a third value derived beside them. Kept for
-- good, like a group; one row is one write, so WITHOUT ROWID and no index.

CREATE TABLE splits (
  id          TEXT PRIMARY KEY,   -- 32 hex, derived from the link secret
  token_hash  TEXT NOT NULL,      -- sha256 of the derived token, as for a group
  sealed      TEXT NOT NULL,      -- base64: version byte, IV, AES-GCM ciphertext
  created_at  INTEGER NOT NULL    -- our clock
) WITHOUT ROWID;
