-- Programmed children always share the programmed principal's calendar.
CREATE FUNCTION public.miagenda_child_schedule_calendar() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE inherited uuid;
BEGIN
 SELECT ps."calendarId" INTO inherited FROM public.activities a
 JOIN public.activity_schedules ps ON ps."activityId"=a."parentId" AND ps."userId"=a."userId"
 WHERE a.id=NEW."activityId" AND a."userId"=NEW."userId";
 IF inherited IS NOT NULL THEN NEW."calendarId":=inherited; END IF;
 RETURN NEW;
END;$fn$;
CREATE TRIGGER schedule_inherit_calendar BEFORE INSERT OR UPDATE OF "calendarId" ON public.activity_schedules
FOR EACH ROW EXECUTE FUNCTION public.miagenda_child_schedule_calendar();

CREATE FUNCTION public.miagenda_parent_schedule_calendar() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 UPDATE public.activity_schedules cs SET "calendarId"=NEW."calendarId" FROM public.activities c
 WHERE c."parentId"=NEW."activityId" AND c."userId"=NEW."userId" AND c.lifecycle='active'
 AND cs."activityId"=c.id AND cs."userId"=c."userId" AND cs."calendarId" IS DISTINCT FROM NEW."calendarId";
 RETURN NULL;
END;$fn$;
CREATE TRIGGER schedule_inherit_children AFTER INSERT OR UPDATE OF "calendarId" ON public.activity_schedules
FOR EACH ROW EXECUTE FUNCTION public.miagenda_parent_schedule_calendar();

CREATE FUNCTION public.miagenda_step_definition_calendar() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NEW."scheduleMode" IS NOT NULL THEN
 SELECT "calendarId" INTO NEW."scheduleCalendarId" FROM public.series_segments WHERE id=NEW."segmentId" AND "userId"=NEW."userId";
 END IF;
 RETURN NEW;
END;$fn$;
CREATE TRIGGER step_schedule_inherit_calendar BEFORE INSERT OR UPDATE ON public.series_step_definitions
FOR EACH ROW EXECUTE FUNCTION public.miagenda_step_definition_calendar();

CREATE FUNCTION public.miagenda_segment_child_calendars() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 UPDATE public.series_step_definitions SET "scheduleCalendarId"=NEW."calendarId"
 WHERE "segmentId"=NEW.id AND "userId"=NEW."userId" AND "scheduleMode" IS NOT NULL AND "scheduleCalendarId" IS DISTINCT FROM NEW."calendarId";
 RETURN NULL;
END;$fn$;
CREATE TRIGGER segment_inherit_child_calendars AFTER UPDATE OF "calendarId" ON public.series_segments
FOR EACH ROW EXECUTE FUNCTION public.miagenda_segment_child_calendars();

UPDATE public.activity_schedules cs SET "calendarId"=ps."calendarId" FROM public.activities c
 JOIN public.activity_schedules ps ON ps."activityId"=c."parentId" AND ps."userId"=c."userId"
 WHERE cs."activityId"=c.id AND cs."userId"=c."userId" AND c.lifecycle='active' AND cs."calendarId" IS DISTINCT FROM ps."calendarId";
UPDATE public.series_step_definitions d SET "scheduleCalendarId"=s."calendarId" FROM public.series_segments s
 WHERE d."segmentId"=s.id AND d."userId"=s."userId" AND d."scheduleMode" IS NOT NULL AND d."scheduleCalendarId" IS DISTINCT FROM s."calendarId";
-- Invalidate virtual reads paired with definitions from before this rule.
UPDATE public.recurrence_series SET revision=revision+1 WHERE "retiredAt" IS NULL;
