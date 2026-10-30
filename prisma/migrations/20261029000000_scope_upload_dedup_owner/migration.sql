-- Deduplicate identical bytes only within the same owner.
DROP INDEX "file_uploads_sha256_key";

CREATE UNIQUE INDEX "file_uploads_owner_id_sha256_key" ON "file_uploads"("owner_id", "sha256");
