BEGIN;
ALTER TABLE public.users ADD COLUMN "retentionCheckedAt" timestamptz(3), ADD COLUMN "retentionSegmentCursor" uuid;
CREATE INDEX "users_retentionCheckedAt_id_idx" ON public.users("retentionCheckedAt", id);
CREATE INDEX "activities_retention_candidates_idx" ON public.activities("userId", "completedAt", id)
  WHERE lifecycle = 'active' AND kind = 'task' AND NOT keep AND "completedAt" IS NOT NULL;
COMMIT;
