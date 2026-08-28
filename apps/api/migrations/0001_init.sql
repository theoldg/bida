-- The op log and its group registry. See docs/data-model.md#d1-schema — this
-- file must stay identical to the SQL block there; update both together.

CREATE TABLE groups (
  id            TEXT PRIMARY KEY,
  secret_hash   TEXT NOT NULL,        -- sha256 of the link secret; never the secret
  created_at    INTEGER NOT NULL,
  last_op_seq   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ops (
  seq        INTEGER NOT NULL,        -- per-group, assigned by the server
  id         TEXT PRIMARY KEY,        -- client-generated UUID = idempotency key
  group_id   TEXT NOT NULL REFERENCES groups(id),
  entity     TEXT NOT NULL,           -- 'group'|'member'|'expense'|'settlement'|'attachment'|'identity'
  entity_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,           -- 'create'|'update'|'delete'|'restore'
  patch      TEXT NOT NULL,           -- JSON, changed fields only
  hlc        TEXT NOT NULL,           -- hybrid logical clock, lexicographically sortable
  actor      TEXT NOT NULL,           -- memberId that made the change
  note       TEXT,                    -- optional human reason: "forgot the rug"
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ops_group_seq ON ops(group_id, seq);
CREATE INDEX ops_group_entity ON ops(group_id, entity_id);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  expense_id TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  width      INTEGER, height INTEGER,
  created_at INTEGER NOT NULL
);
