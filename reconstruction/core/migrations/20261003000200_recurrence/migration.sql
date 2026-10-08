BEGIN;
-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "occurrenceId" UUID,
ADD COLUMN     "stepKeyId" UUID;

-- CreateTable
CREATE TABLE "recurrence_series" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_segments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seriesId" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "fromOrdinal" BIGINT NOT NULL,
    "toOrdinal" BIGINT,
    "title" VARCHAR(250) NOT NULL,
    "description" TEXT,
    "mode" "ScheduleMode" NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "anchorLocal" VARCHAR(32) NOT NULL,
    "rrule" TEXT NOT NULL,
    "untilDate" DATE,
    "durationMinutes" INTEGER,
    "durationDays" INTEGER,
    "clampInvalidMonthDay" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "series_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_step_keys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seriesId" UUID NOT NULL,

    CONSTRAINT "series_step_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_step_definitions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "stepKeyId" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "series_step_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occurrence_overrides" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seriesId" UUID NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "originalLocal" VARCHAR(32) NOT NULL,
    "originalTimeZone" VARCHAR(64) NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "retirementReason" VARCHAR(20),
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "occurrence_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurrence_series_userId_retiredAt_idx" ON "recurrence_series"("userId", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "recurrence_series_id_userId_key" ON "recurrence_series"("id", "userId");

-- CreateIndex
CREATE INDEX "series_segments_userId_calendarId_idx" ON "series_segments"("userId", "calendarId");

-- CreateIndex
CREATE UNIQUE INDEX "series_segments_id_userId_key" ON "series_segments"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "series_segments_seriesId_fromOrdinal_key" ON "series_segments"("seriesId", "fromOrdinal");

-- CreateIndex
CREATE INDEX "series_step_keys_seriesId_idx" ON "series_step_keys"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "series_step_keys_id_userId_key" ON "series_step_keys"("id", "userId");

-- CreateIndex
CREATE INDEX "series_step_definitions_segmentId_position_idx" ON "series_step_definitions"("segmentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "series_step_definitions_segmentId_stepKeyId_key" ON "series_step_definitions"("segmentId", "stepKeyId");

-- CreateIndex
CREATE INDEX "occurrence_overrides_userId_retiredAt_idx" ON "occurrence_overrides"("userId", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "occurrence_overrides_id_userId_key" ON "occurrence_overrides"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "occurrence_overrides_seriesId_ordinal_key" ON "occurrence_overrides"("seriesId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "activities_occurrenceId_key" ON "activities"("occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "activities_occurrenceId_userId_key" ON "activities"("occurrenceId", "userId");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_occurrenceId_userId_fkey" FOREIGN KEY ("occurrenceId", "userId") REFERENCES "occurrence_overrides"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_stepKeyId_userId_fkey" FOREIGN KEY ("stepKeyId", "userId") REFERENCES "series_step_keys"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recurrence_series" ADD CONSTRAINT "recurrence_series_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "series_segments" ADD CONSTRAINT "series_segments_seriesId_userId_fkey" FOREIGN KEY ("seriesId", "userId") REFERENCES "recurrence_series"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "series_segments" ADD CONSTRAINT "series_segments_calendarId_userId_fkey" FOREIGN KEY ("calendarId", "userId") REFERENCES "calendars"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "series_step_keys" ADD CONSTRAINT "series_step_keys_seriesId_userId_fkey" FOREIGN KEY ("seriesId", "userId") REFERENCES "recurrence_series"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "series_step_definitions" ADD CONSTRAINT "series_step_definitions_segmentId_userId_fkey" FOREIGN KEY ("segmentId", "userId") REFERENCES "series_segments"("id", "userId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "series_step_definitions" ADD CONSTRAINT "series_step_definitions_stepKeyId_userId_fkey" FOREIGN KEY ("stepKeyId", "userId") REFERENCES "series_step_keys"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "occurrence_overrides" ADD CONSTRAINT "occurrence_overrides_seriesId_userId_fkey" FOREIGN KEY ("seriesId", "userId") REFERENCES "recurrence_series"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;



-- Appended once to the forward migration; never run separately.
ALTER TABLE public.recurrence_series ADD CONSTRAINT recurrence_series_values CHECK (revision >= 0 AND ("retiredAt" IS NULL OR isfinite("retiredAt")));
ALTER TABLE public.series_segments ADD CONSTRAINT series_segment_values CHECK (
  "fromOrdinal" >= 0 AND ("toOrdinal" IS NULL OR "toOrdinal" > "fromOrdinal")
  AND length(btrim(title)) > 0 AND "clampInvalidMonthDay"
  AND ((mode = 'timed' AND "durationMinutes" > 0 AND "durationMinutes" % 15 = 0 AND "durationDays" IS NULL AND "anchorLocal" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')
    OR (mode = 'allDay' AND "durationDays" > 0 AND "durationMinutes" IS NULL AND "anchorLocal" ~ '^\d{4}-\d{2}-\d{2}$'))
);
ALTER TABLE public.occurrence_overrides ADD CONSTRAINT occurrence_override_values CHECK (ordinal >= 0 AND revision >= 0 AND ("retiredAt" IS NULL OR isfinite("retiredAt")));
ALTER TABLE public.series_step_definitions ADD CONSTRAINT series_step_definition_values CHECK (position >= 0 AND length(btrim(title)) > 0);

CREATE FUNCTION public.miagenda_recurrence_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE owner_id uuid;
BEGIN
  owner_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."userId" ELSE NEW."userId" END;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    RAISE EXCEPTION 'Recurrence identity and owner are immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM public.miagenda_touch_owner(owner_id);
  IF TG_TABLE_NAME = 'recurrence_series' THEN
    IF TG_OP = 'INSERT' THEN NEW.revision := 0;
    ELSIF TG_OP = 'UPDATE' THEN NEW.revision := OLD.revision + 1; END IF;
  ELSIF TG_TABLE_NAME = 'series_segments' THEN
    IF TG_OP <> 'DELETE' THEN
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW."timeZone") THEN
        RAISE EXCEPTION 'Invalid recurrence time zone' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' AND NEW."seriesId" IS DISTINCT FROM OLD."seriesId" THEN
        RAISE EXCEPTION 'Segment family is immutable' USING ERRCODE = '23514';
      END IF;
      UPDATE public.recurrence_series SET revision = revision + 1 WHERE id = NEW."seriesId" AND "userId" = owner_id;
    ELSE
      UPDATE public.recurrence_series SET revision = revision + 1 WHERE id = OLD."seriesId" AND "userId" = owner_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'occurrence_overrides' THEN
    IF TG_OP = 'UPDATE' THEN
      IF (NEW."seriesId", NEW.ordinal, NEW."originalLocal", NEW."originalTimeZone") IS DISTINCT FROM
         (OLD."seriesId", OLD.ordinal, OLD."originalLocal", OLD."originalTimeZone") THEN
        RAISE EXCEPTION 'Original occurrence identity is immutable' USING ERRCODE = '23514';
      END IF;
      NEW.revision := OLD.revision + 1;
    ELSIF TG_OP = 'INSERT' THEN NEW.revision := 0; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER recurrence_series_revision BEFORE INSERT OR UPDATE OR DELETE ON public.recurrence_series FOR EACH ROW EXECUTE FUNCTION public.miagenda_recurrence_write();
CREATE TRIGGER recurrence_segment_revision BEFORE INSERT OR UPDATE OR DELETE ON public.series_segments FOR EACH ROW EXECUTE FUNCTION public.miagenda_recurrence_write();
CREATE TRIGGER recurrence_override_revision BEFORE INSERT OR UPDATE OR DELETE ON public.occurrence_overrides FOR EACH ROW EXECUTE FUNCTION public.miagenda_recurrence_write();
CREATE TRIGGER recurrence_step_key_revision BEFORE INSERT OR UPDATE OR DELETE ON public.series_step_keys FOR EACH ROW EXECUTE FUNCTION public.miagenda_recurrence_write();
CREATE TRIGGER recurrence_step_definition_revision BEFORE INSERT OR UPDATE OR DELETE ON public.series_step_definitions FOR EACH ROW EXECUTE FUNCTION public.miagenda_recurrence_write();

CREATE FUNCTION public.miagenda_activity_recurrence_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."occurrenceId", NEW."stepKeyId") IS DISTINCT FROM (OLD."occurrenceId", OLD."stepKeyId") THEN
    RAISE EXCEPTION 'Activity recurrence identity is immutable' USING ERRCODE = '23514';
  END IF;
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
CREATE TRIGGER activity_recurrence_identity BEFORE INSERT OR UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.miagenda_activity_recurrence_identity();

COMMIT;
