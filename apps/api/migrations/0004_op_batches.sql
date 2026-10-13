-- A push's ops in one row. See docs/sync.md#the-log-is-kept-in-batches — the
-- SQL block in docs/data-model.md#d1-schema says the same.
--
-- D1 bills a write for every row a statement touches, indexes included, so an
-- op in `ops` costs three; a row here holds up to a few hundred and costs one.
-- WITHOUT ROWID with no second index is what keeps it at one. `ops` stays
-- read-only beside it: what is in it is somebody's ledger.

CREATE TABLE op_batches (
  group_id    TEXT NOT NULL,
  last_seq    INTEGER NOT NULL,   -- the row holds seqs last_seq - n + 1 .. last_seq
  ids         TEXT NOT NULL,      -- JSON array of the n op ids, in seq order
  sealed      TEXT NOT NULL,      -- JSON array of their base64 seals, same order
  received_at INTEGER NOT NULL,   -- our clock
  PRIMARY KEY (group_id, last_seq)
) WITHOUT ROWID;
