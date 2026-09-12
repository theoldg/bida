-- The sealed op log and its group registry. See docs/data-model.md#d1-schema —
-- this file must stay identical to the SQL block there; update both together.
--
-- Everything an op means is inside `sealed`, encrypted under a key derived from
-- the link secret that this server never receives (ADR-0036). What is left in
-- the clear is what routing needs: which group, which op, and in what order.

CREATE TABLE groups (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL,        -- sha256 of the derived bearer token
  created_at    INTEGER NOT NULL,
  last_op_seq   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ops (
  seq         INTEGER NOT NULL,       -- per-group, assigned by the server
  id          TEXT PRIMARY KEY,       -- client-generated UUID = idempotency key
  group_id    TEXT NOT NULL REFERENCES groups(id),
  sealed      TEXT NOT NULL,          -- base64: version byte, IV, AES-GCM ciphertext
  received_at INTEGER NOT NULL        -- our clock, not the phone's; the phone's is sealed
);
CREATE UNIQUE INDEX ops_group_seq ON ops(group_id, seq);
