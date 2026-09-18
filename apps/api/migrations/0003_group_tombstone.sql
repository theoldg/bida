-- A group deleted on request, from `/delete-my-data`. See
-- docs/sync.md#deleting-a-group — this file must stay identical to the SQL
-- block in docs/data-model.md#d1-schema.
--
-- The row outlives the group on purpose. Deleting it outright would let the
-- next phone that still holds the link push its own copy back and register the
-- id afresh, which would make the delete screen's promise false; a tombstone is
-- what the Worker checks to refuse that push. What is left in it says nothing:
-- an opaque id, a hash of a derived token, and two timestamps.

ALTER TABLE groups ADD COLUMN deleted_at INTEGER;
