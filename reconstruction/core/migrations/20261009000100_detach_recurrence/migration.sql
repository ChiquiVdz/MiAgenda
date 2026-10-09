-- Preserve Activity IDs while explicitly converting a recurrence exception to a task.
CREATE OR REPLACE FUNCTION public.miagenda_activity_recurrence_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE detaching boolean;
BEGIN
 detaching := COALESCE(current_setting('miagenda.detach_recurrence',true),'')=NEW."userId"::text;
 IF TG_OP='UPDATE' AND (
   (NEW."occurrenceId" IS DISTINCT FROM OLD."occurrenceId" AND NOT(detaching AND NEW."occurrenceId" IS NULL)) OR
   (OLD."stepKeyId" IS NOT NULL AND NEW."stepKeyId" IS DISTINCT FROM OLD."stepKeyId" AND NOT(detaching AND NEW."stepKeyId" IS NULL))
 ) THEN RAISE EXCEPTION 'Activity recurrence identity is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD."occurrenceId" IS NOT NULL AND NEW."occurrenceId" IS NULL AND EXISTS(
   SELECT 1 FROM public.activities WHERE "userId"=NEW."userId" AND "parentId"=NEW.id AND "stepKeyId" IS NOT NULL
 ) THEN RAISE EXCEPTION 'Detach child keys before parent ancestry' USING ERRCODE='23514'; END IF;
 IF NEW."occurrenceId" IS NOT NULL AND (NEW."parentId" IS NOT NULL OR NEW.kind<>'task') THEN
   RAISE EXCEPTION 'Only root tasks may materialize a recurrence' USING ERRCODE='23514'; END IF;
 IF NEW."stepKeyId" IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.activities p JOIN public.occurrence_overrides o ON o.id=p."occurrenceId" AND o."userId"=p."userId"
   JOIN public.series_step_keys k ON k."seriesId"=o."seriesId" AND k."userId"=p."userId"
   WHERE p.id=NEW."parentId" AND p."userId"=NEW."userId" AND k.id=NEW."stepKeyId"
 ) THEN RAISE EXCEPTION 'Step key must belong to parent family' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$fn$;
