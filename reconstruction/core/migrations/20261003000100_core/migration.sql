-- ISOLATED DATABASE ONLY. Do not execute against the current MiAgenda DB.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND c.relname <> '_prisma_migrations'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'e')) THEN
    RAISE EXCEPTION 'MiAgenda core requires an empty isolated database; no existing objects were changed';
  END IF;
END
$guard$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('task', 'meal');

-- CreateEnum
CREATE TYPE "ActivityLifecycle" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('timed', 'allDay');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMPTZ(3),
    "image" TEXT,
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
    "dataRevision" BIGINT NOT NULL DEFAULT 0,
    "eatingMinutes" INTEGER NOT NULL DEFAULT 20,
    "washingMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL
);

-- CreateTable
CREATE TABLE "calendars" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "moduleKey" VARCHAR(40),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_preferences" (
    "calendarId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "calendar_preferences_pkey" PRIMARY KEY ("calendarId")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL DEFAULT 'task',
    "lifecycle" "ActivityLifecycle" NOT NULL DEFAULT 'active',
    "title" VARCHAR(250) NOT NULL,
    "description" TEXT,
    "parentId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMPTZ(3),
    "keep" BOOLEAN NOT NULL DEFAULT false,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "progressSequence" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_schedules" (
    "activityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "mode" "ScheduleMode" NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "startDate" DATE,
    "endDate" DATE,
    "purgeEligibleAt" TIMESTAMPTZ(3),

    CONSTRAINT "activity_schedules_pkey" PRIMARY KEY ("activityId")
);

-- CreateTable
CREATE TABLE "command_receipts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "committedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "command_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expires_idx" ON "sessions"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "calendars_userId_name_idx" ON "calendars"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "calendars_id_userId_key" ON "calendars"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "calendars_userId_moduleKey_key" ON "calendars"("userId", "moduleKey");

-- CreateIndex
CREATE INDEX "calendar_preferences_userId_position_idx" ON "calendar_preferences"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_preferences_calendarId_userId_key" ON "calendar_preferences"("calendarId", "userId");

-- CreateIndex
CREATE INDEX "activities_userId_lifecycle_completedAt_idx" ON "activities"("userId", "lifecycle", "completedAt");

-- CreateIndex
CREATE INDEX "activities_userId_parentId_position_idx" ON "activities"("userId", "parentId", "position");

-- CreateIndex
CREATE INDEX "activities_userId_highlighted_idx" ON "activities"("userId", "highlighted");

-- CreateIndex
CREATE UNIQUE INDEX "activities_id_userId_key" ON "activities"("id", "userId");

-- CreateIndex
CREATE INDEX "activity_schedules_userId_calendarId_startsAt_idx" ON "activity_schedules"("userId", "calendarId", "startsAt");

-- CreateIndex
CREATE INDEX "activity_schedules_userId_calendarId_startDate_idx" ON "activity_schedules"("userId", "calendarId", "startDate");

-- CreateIndex
CREATE INDEX "activity_schedules_purgeEligibleAt_idx" ON "activity_schedules"("purgeEligibleAt");

-- CreateIndex
CREATE UNIQUE INDEX "activity_schedules_activityId_userId_key" ON "activity_schedules"("activityId", "userId");

-- CreateIndex
CREATE INDEX "command_receipts_expiresAt_idx" ON "command_receipts"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "command_receipts_userId_commandId_key" ON "command_receipts"("userId", "commandId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "calendar_preferences" ADD CONSTRAINT "calendar_preferences_calendarId_userId_fkey" FOREIGN KEY ("calendarId", "userId") REFERENCES "calendars"("id", "userId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_parentId_userId_fkey" FOREIGN KEY ("parentId", "userId") REFERENCES "activities"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_schedules" ADD CONSTRAINT "activity_schedules_activityId_userId_fkey" FOREIGN KEY ("activityId", "userId") REFERENCES "activities"("id", "userId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_schedules" ADD CONSTRAINT "activity_schedules_calendarId_userId_fkey" FOREIGN KEY ("calendarId", "userId") REFERENCES "calendars"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- Additional domain constraints, not represented by Prisma.
-- Supplemental constraints for the isolated core. Not a standalone migration.
-- Services must use READ COMMITTED writes and revision predicates.
-- Later Cuisine/recurrence migrations must explicitly replace the task-only gate.

ALTER TABLE public.users ADD CONSTRAINT users_core_values CHECK (
  "dataRevision" >= 0 AND "eatingMinutes" >= 0 AND "washingMinutes" >= 0
);
ALTER TABLE public.accounts ADD CONSTRAINT accounts_identity_only CHECK (
  provider = 'google' AND type = 'oauth' AND length("providerAccountId") > 0
  AND refresh_token IS NULL AND access_token IS NULL AND id_token IS NULL
);
ALTER TABLE public.calendars ADD CONSTRAINT calendars_core_values CHECK (
  length(btrim(name)) > 0 AND color ~ '^#[0-9a-fA-F]{6}$' AND revision >= 0
  AND ("moduleKey" IS NULL OR "moduleKey" ~ '^[a-z][a-z0-9_-]{0,39}$')
);
ALTER TABLE public.calendar_preferences ADD CONSTRAINT calendar_preferences_position CHECK (position >= 0);
ALTER TABLE public.activities ADD CONSTRAINT activities_core_values CHECK (
  (lifecycle = 'retired' OR length(btrim(title)) > 0)
  AND position >= 0 AND revision >= 0 AND "progressSequence" >= 0
  AND ("parentId" IS NULL OR "parentId" <> id)
  AND ("completedAt" IS NULL OR isfinite("completedAt"))
);
ALTER TABLE public.activities ADD CONSTRAINT activities_core_task_only CHECK (kind = 'task');
ALTER TABLE public.activity_schedules ADD CONSTRAINT schedule_valid_shape CHECK (
  (mode = 'timed' AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL
    AND isfinite("startsAt") AND isfinite("endsAt") AND "endsAt" > "startsAt"
    AND "startDate" IS NULL AND "endDate" IS NULL)
  OR
  (mode = 'allDay' AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL
    AND isfinite("startDate") AND isfinite("endDate") AND "endDate" > "startDate"
    AND "startsAt" IS NULL AND "endsAt" IS NULL)
);
ALTER TABLE public.command_receipts ADD CONSTRAINT command_receipts_core_values CHECK (
  length(btrim(action)) > 0 AND "payloadHash" ~ '^[0-9a-f]{64}$'
  AND ("expiresAt" IS NULL OR "expiresAt" > "committedAt")
);

CREATE FUNCTION public.miagenda_identity_scopes_only(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $fn$
  SELECT value IS NULL OR NOT EXISTS (
    SELECT 1 FROM regexp_split_to_table(btrim(value), '\s+') AS tokens(scope)
    WHERE scope NOT IN ('', 'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile')
  );
$fn$;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_scope_identity_only CHECK (public.miagenda_identity_scopes_only(scope));

-- A shared row write is a concurrency fence even when a caller chooses an
-- inappropriate stronger snapshot isolation level. Domain writes touch the same
-- owner's revision; the API must handle 40001/40P01 with bounded retry.
CREATE FUNCTION public.miagenda_touch_owner(owner_id uuid) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $fn$
DECLARE next_revision bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  UPDATE public.users SET "dataRevision" = "dataRevision" + 1,
    "updatedAt" = clock_timestamp() WHERE id = owner_id
    RETURNING "dataRevision" INTO next_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown activity owner' USING ERRCODE = '23503'; END IF;
  RETURN next_revision;
END;
$fn$;

CREATE FUNCTION public.miagenda_validate_user() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'User identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW."timeZone") THEN
    RAISE EXCEPTION 'Invalid user time zone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER user_identity_and_zone BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.miagenda_validate_user();

CREATE FUNCTION public.miagenda_activity_before_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE owner_id uuid; next_revision bigint; meaningful boolean;
BEGIN
  owner_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."userId" ELSE NEW."userId" END;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'Activity identity, owner and kind are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.highlighted AND NOT OLD.highlighted THEN NEW.keep := true; END IF;
    meaningful := (to_jsonb(NEW) - 'revision' - 'updatedAt' - 'progressSequence')
      IS DISTINCT FROM (to_jsonb(OLD) - 'revision' - 'updatedAt' - 'progressSequence');
    -- An exact one-step revision advance also invalidates the aggregate when
    -- its schedule or a child changes. Arbitrary client revisions are ignored.
    IF NOT meaningful AND NEW.revision <> OLD.revision + 1 THEN
      NEW.revision := OLD.revision;
      NEW."progressSequence" := OLD."progressSequence";
      NEW."updatedAt" := OLD."updatedAt";
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.highlighted THEN NEW.keep := true; END IF;
  END IF;
  next_revision := public.miagenda_touch_owner(owner_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.revision := 0;
    NEW."progressSequence" := CASE WHEN NEW."completedAt" IS NULL THEN 0 ELSE next_revision END;
  ELSE
    NEW.revision := OLD.revision + 1;
    NEW."progressSequence" := CASE WHEN NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
      THEN next_revision ELSE OLD."progressSequence" END;
  END IF;
  NEW."updatedAt" := clock_timestamp();
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER activity_identity_revision BEFORE INSERT OR UPDATE OR DELETE ON public.activities
FOR EACH ROW EXECUTE FUNCTION public.miagenda_activity_before_write();

CREATE FUNCTION public.miagenda_calendar_before_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."moduleKey" IS NOT NULL THEN
      RAISE EXCEPTION 'Module calendar cannot be removed while bound' USING ERRCODE = '23514';
    END IF;
    PERFORM public.miagenda_touch_owner(OLD."userId");
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW."moduleKey" IS DISTINCT FROM OLD."moduleKey" THEN
      RAISE EXCEPTION 'Calendar identity, owner and binding are immutable' USING ERRCODE = '23514';
    END IF;
    NEW.revision := OLD.revision + 1;
  ELSE NEW.revision := 0;
  END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId");
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER calendar_identity_revision BEFORE INSERT OR UPDATE OR DELETE ON public.calendars
FOR EACH ROW EXECUTE FUNCTION public.miagenda_calendar_before_write();

CREATE FUNCTION public.miagenda_schedule_before_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE completed_at timestamptz; keep_detail boolean; actual_end timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.miagenda_touch_owner(OLD."userId"); RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."activityId" IS DISTINCT FROM OLD."activityId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    RAISE EXCEPTION 'Schedule activity and owner are immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId");
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW."timeZone") THEN
    RAISE EXCEPTION 'Invalid schedule time zone' USING ERRCODE = '23514';
  END IF;
  SELECT "completedAt", keep INTO completed_at, keep_detail FROM public.activities
    WHERE id = NEW."activityId" AND "userId" = NEW."userId";
  actual_end := CASE WHEN NEW.mode = 'timed' THEN NEW."endsAt"
    ELSE NEW."endDate"::timestamp AT TIME ZONE NEW."timeZone" END;
  NEW."purgeEligibleAt" := CASE WHEN completed_at IS NULL OR keep_detail THEN NULL
    ELSE greatest(completed_at + interval '120 hours', actual_end) END;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER schedule_validate_and_retention BEFORE INSERT OR UPDATE OR DELETE ON public.activity_schedules
FOR EACH ROW EXECUTE FUNCTION public.miagenda_schedule_before_write();

CREATE FUNCTION public.miagenda_schedule_bump_activity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - 'purgeEligibleAt') IS NOT DISTINCT FROM
    (to_jsonb(OLD) - 'purgeEligibleAt') THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.activities SET revision = revision + 1
      WHERE id = OLD."activityId" AND "userId" = OLD."userId";
  ELSE
    UPDATE public.activities SET revision = revision + 1
      WHERE id = NEW."activityId" AND "userId" = NEW."userId";
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE TRIGGER schedule_aggregate_revision AFTER INSERT OR UPDATE OR DELETE ON public.activity_schedules
FOR EACH ROW EXECUTE FUNCTION public.miagenda_schedule_bump_activity();

CREATE FUNCTION public.miagenda_child_bump_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.revision = OLD.revision AND
    NEW."parentId" IS NOT DISTINCT FROM OLD."parentId" THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' AND OLD."parentId" IS NOT NULL THEN
    UPDATE public.activities SET revision = revision + 1
      WHERE id = OLD."parentId" AND "userId" = OLD."userId";
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."parentId" IS NOT NULL AND
    (TG_OP = 'INSERT' OR NEW."parentId" IS DISTINCT FROM OLD."parentId") THEN
    UPDATE public.activities SET revision = revision + 1
      WHERE id = NEW."parentId" AND "userId" = NEW."userId";
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE TRIGGER child_aggregate_revision AFTER INSERT OR UPDATE OR DELETE ON public.activities
FOR EACH ROW EXECUTE FUNCTION public.miagenda_child_bump_parent();

CREATE FUNCTION public.miagenda_preference_before_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.miagenda_touch_owner(OLD."userId"); RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."calendarId" IS DISTINCT FROM OLD."calendarId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    RAISE EXCEPTION 'Calendar preference identity is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId"); RETURN NEW;
END;
$fn$;
CREATE TRIGGER preference_identity BEFORE INSERT OR UPDATE OR DELETE ON public.calendar_preferences
FOR EACH ROW EXECUTE FUNCTION public.miagenda_preference_before_write();

-- Only recalculate when the value differs; otherwise an UPDATE of Activity could
-- recursively queue unnecessary schedule work and increment revisions forever.
CREATE FUNCTION public.miagenda_refresh_schedule_retention() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE expected timestamptz;
BEGIN
  SELECT CASE WHEN NEW."completedAt" IS NULL OR NEW.keep THEN NULL
    ELSE greatest(NEW."completedAt" + interval '120 hours',
      CASE WHEN mode = 'timed' THEN "endsAt" ELSE "endDate"::timestamp AT TIME ZONE "timeZone" END) END
    INTO expected FROM public.activity_schedules WHERE "activityId" = NEW.id AND "userId" = NEW."userId";
  UPDATE public.activity_schedules SET "purgeEligibleAt" = expected
    WHERE "activityId" = NEW.id AND "userId" = NEW."userId" AND "purgeEligibleAt" IS DISTINCT FROM expected;
  RETURN NULL;
END;
$fn$;
CREATE TRIGGER activity_retention_refresh AFTER INSERT OR UPDATE OF "completedAt", keep ON public.activities
FOR EACH ROW EXECUTE FUNCTION public.miagenda_refresh_schedule_retention();

-- Commit-time checks query the FINAL state, not the OLD/NEW snapshot queued
-- earlier in the transaction. This allows clear flags + delete schedule atomically.
CREATE FUNCTION public.miagenda_check_activity(activity_id uuid, owner_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE current_activity public.activities%ROWTYPE; parent_record public.activities%ROWTYPE;
BEGIN
  SELECT * INTO current_activity FROM public.activities WHERE id = activity_id AND "userId" = owner_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF current_activity."parentId" IS NOT NULL THEN
    SELECT * INTO parent_record FROM public.activities WHERE id = current_activity."parentId" AND "userId" = owner_id;
    IF NOT FOUND OR parent_record."parentId" IS NOT NULL
      OR (current_activity.lifecycle = 'active' AND parent_record.lifecycle <> 'active') THEN
      RAISE EXCEPTION 'Activity parent must be a root of the same owner' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.activities WHERE "parentId" = current_activity.id AND "userId" = owner_id) THEN
      RAISE EXCEPTION 'A subtask cannot have children' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF current_activity.lifecycle = 'active' AND current_activity.kind = 'task' THEN
    IF current_activity."completedAt" IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.activities WHERE "parentId" = activity_id AND "userId" = owner_id
        AND lifecycle = 'active' AND "completedAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'Completed task has pending children' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (current_activity.keep OR current_activity.highlighted)
    AND NOT EXISTS (SELECT 1 FROM public.activity_schedules WHERE "activityId" = activity_id AND "userId" = owner_id) THEN
    RAISE EXCEPTION 'Keep and highlight require a schedule' USING ERRCODE = '23514';
  END IF;
  IF current_activity.lifecycle = 'retired' AND (
    current_activity.keep OR current_activity.highlighted
    OR EXISTS (SELECT 1 FROM public.activity_schedules WHERE "activityId" = activity_id AND "userId" = owner_id)) THEN
    RAISE EXCEPTION 'Retired activity cannot remain scheduled, kept or highlighted' USING ERRCODE = '23514';
  END IF;
END;
$fn$;

CREATE FUNCTION public.miagenda_activity_constraint() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.miagenda_check_activity(NEW.id, NEW."userId");
    IF NEW."parentId" IS NOT NULL THEN PERFORM public.miagenda_check_activity(NEW."parentId", NEW."userId"); END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.miagenda_check_activity(OLD.id, OLD."userId");
    IF OLD."parentId" IS NOT NULL THEN PERFORM public.miagenda_check_activity(OLD."parentId", OLD."userId"); END IF;
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER activity_final_integrity AFTER INSERT OR UPDATE OR DELETE ON public.activities
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_activity_constraint();

CREATE FUNCTION public.miagenda_schedule_constraint() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM public.miagenda_check_activity(NEW."activityId", NEW."userId"); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM public.miagenda_check_activity(OLD."activityId", OLD."userId"); END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER schedule_final_integrity AFTER INSERT OR UPDATE OR DELETE ON public.activity_schedules
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_schedule_constraint();

-- These are integrity guards, not authorization. The authenticated API must
-- authorize the session's owner and use revision predicates before writing.

COMMIT;
