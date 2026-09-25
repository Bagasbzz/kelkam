-- Add unique constraint on (tugas_id, position) for atomic position assignment.
-- Pairs with `assignPositionWithRetry()` in src/lib/server/tugas/position.ts
-- to prevent two concurrent submissions from landing on the same position.

CREATE UNIQUE INDEX "tugas_submissions_tugas_id_position_key" ON "tugas_submissions"("tugas_id", "position");

-- Drop the now-redundant non-unique index.
DROP INDEX IF EXISTS "tugas_submissions_tugas_id_position_idx";