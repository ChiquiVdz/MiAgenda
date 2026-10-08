-- Existing snapshots keep their independent reminder semantics.
ALTER TABLE public.recipe_steps ADD COLUMN "priorGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.recipe_steps ADD CONSTRAINT recipe_prior_group_valid CHECK (NOT "priorGroup" OR ("minutesBefore" IS NOT NULL AND "priorTitle" IS NOT NULL));
