-- Kept receipt photos (docs/photos.md). The bytes are in R2, sealed; D1 holds
-- the index and the budget that keeps R2 inside its free tier. Nothing here
-- reads a photo, and nothing names a person.

-- One row per object in the bucket, so a deletion knows what it gives back and
-- a group's deletion can find its photos without listing the bucket (a list
-- is a paid operation; a delete is free).
CREATE TABLE photos (
  group_id    TEXT NOT NULL,
  id          TEXT NOT NULL,
  bytes       INTEGER NOT NULL,   -- sealed size, as stored
  created_at  INTEGER NOT NULL,   -- our clock
  PRIMARY KEY (group_id, id)
) WITHOUT ROWID;

-- Running totals, checked before R2 is touched: `stored` (bytes held now) and
-- `writes:YYYY-MM` (uploads this calendar month, UTC).
CREATE TABLE photo_usage (
  key    TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
) WITHOUT ROWID;
