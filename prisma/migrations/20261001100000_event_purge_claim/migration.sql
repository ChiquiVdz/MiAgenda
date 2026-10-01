ALTER TABLE "event_overlays"
ADD COLUMN "purge_started_at" TIMESTAMP(3);

CREATE INDEX "event_overlays_purge_after_purge_started_at_idx"
ON "event_overlays"("purge_after", "purge_started_at");
