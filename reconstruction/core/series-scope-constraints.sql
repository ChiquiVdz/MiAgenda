ALTER TABLE public.series_step_definitions ADD CONSTRAINT step_definition_sequence CHECK ("createdSequence" >= 0);
ALTER TABLE public.series_progress_rules ADD CONSTRAINT progress_rule_values CHECK (
  "fromOrdinal" >= 0 AND ("toOrdinal" IS NULL OR "toOrdinal" > "fromOrdinal") AND sequence >= 0 AND isfinite("appliedAt")
);
ALTER TABLE public.occurrence_retirement_ranges ADD CONSTRAINT retirement_range_values CHECK (
  "fromOrdinal" >= 0 AND "toOrdinal" > "fromOrdinal" AND reason IN ('deleted', 'purged')
);
CREATE TRIGGER recurrence_progress_revision BEFORE INSERT OR UPDATE OR DELETE ON public.series_progress_rules FOR EACH ROW EXECUTE FUNCTION public.miagenda_recurrence_write();
CREATE TRIGGER recurrence_retirement_revision BEFORE INSERT OR UPDATE OR DELETE ON public.occurrence_retirement_ranges FOR EACH ROW EXECUTE FUNCTION public.miagenda_recurrence_write();

CREATE OR REPLACE FUNCTION public.miagenda_activity_recurrence_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."occurrenceId" IS DISTINCT FROM OLD."occurrenceId"
    OR (OLD."stepKeyId" IS NOT NULL AND NEW."stepKeyId" IS DISTINCT FROM OLD."stepKeyId")) THEN
    RAISE EXCEPTION 'Activity recurrence identity is immutable' USING ERRCODE = '23514';
  END IF;
  -- A previously private legacy child may receive a key once. It never merges
  -- with another step by text; subsequent renames retain this same key.
  IF NEW."occurrenceId" IS NOT NULL AND (NEW."parentId" IS NOT NULL OR NEW.kind <> 'task') THEN
    RAISE EXCEPTION 'Only root tasks may materialize a recurrence' USING ERRCODE = '23514';
  END IF;
  IF NEW."stepKeyId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.activities p JOIN public.occurrence_overrides o ON o.id = p."occurrenceId" AND o."userId" = p."userId"
    JOIN public.series_step_keys k ON k."seriesId" = o."seriesId" AND k."userId" = p."userId"
    WHERE p.id = NEW."parentId" AND p."userId" = NEW."userId" AND k.id = NEW."stepKeyId"
  ) THEN RAISE EXCEPTION 'Step key must belong to parent family' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION public.miagenda_series_scope_integrity() RETURNS trigger
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
CREATE TRIGGER definition_family_integrity BEFORE INSERT OR UPDATE ON public.series_step_definitions FOR EACH ROW EXECUTE FUNCTION public.miagenda_series_scope_integrity();
CREATE TRIGGER step_key_family_integrity BEFORE INSERT OR UPDATE ON public.series_step_keys FOR EACH ROW EXECUTE FUNCTION public.miagenda_series_scope_integrity();
CREATE TRIGGER progress_family_integrity BEFORE INSERT OR UPDATE ON public.series_progress_rules FOR EACH ROW EXECUTE FUNCTION public.miagenda_series_scope_integrity();
CREATE TRIGGER retirement_family_integrity BEFORE INSERT OR UPDATE ON public.occurrence_retirement_ranges FOR EACH ROW EXECUTE FUNCTION public.miagenda_series_scope_integrity();
