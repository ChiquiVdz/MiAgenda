-- Correct table dispatch before accessing progress-only fields.
BEGIN;
CREATE OR REPLACE FUNCTION public.miagenda_series_scope_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE family uuid;
BEGIN
  IF TG_TABLE_NAME = 'series_step_definitions' THEN
    SELECT "seriesId" INTO family FROM public.series_segments WHERE id = NEW."segmentId" AND "userId" = NEW."userId";
    IF family IS NULL OR NOT EXISTS (SELECT 1 FROM public.series_step_keys WHERE id = NEW."stepKeyId" AND "userId" = NEW."userId" AND "seriesId" = family) THEN
      RAISE EXCEPTION 'Step definition must belong to segment family' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."segmentId", NEW."stepKeyId", NEW."createdSequence") IS DISTINCT FROM (OLD."segmentId", OLD."stepKeyId", OLD."createdSequence") THEN
      RAISE EXCEPTION 'Definition identity and creation sequence are immutable' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW."seriesId" IS DISTINCT FROM OLD."seriesId" THEN RAISE EXCEPTION 'Series reference is immutable' USING ERRCODE = '23514'; END IF;
    -- Separate table dispatch: PL/pgSQL resolves record fields before SQL
    -- boolean short-circuiting; series_step_keys has no stepKeyId column.
    IF TG_TABLE_NAME = 'series_progress_rules' THEN
      IF NEW."stepKeyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.series_step_keys WHERE id = NEW."stepKeyId" AND "userId" = NEW."userId" AND "seriesId" = NEW."seriesId") THEN
        RAISE EXCEPTION 'Progress step must belong to family' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
COMMIT;
