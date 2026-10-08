ALTER TABLE public.series_step_definitions
 ADD COLUMN "scheduleCalendarId" UUID,
 ADD COLUMN "scheduleMode" "ScheduleMode",
 ADD COLUMN "scheduleTimeZone" VARCHAR(64),
 ADD COLUMN "scheduleDayOffset" INTEGER,
 ADD COLUMN "scheduleTime" VARCHAR(5),
 ADD COLUMN "scheduleDurationMinutes" INTEGER,
 ADD COLUMN "scheduleDurationDays" INTEGER,
 ADD COLUMN "scheduleHistory" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE public.series_step_definitions ADD CONSTRAINT step_schedule_calendar_owner
 FOREIGN KEY ("scheduleCalendarId", "userId") REFERENCES public.calendars(id, "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE public.series_step_definitions ADD CONSTRAINT step_schedule_valid CHECK (
 ("scheduleCalendarId" IS NULL AND "scheduleMode" IS NULL AND "scheduleTimeZone" IS NULL AND "scheduleDayOffset" IS NULL AND "scheduleTime" IS NULL AND "scheduleDurationMinutes" IS NULL AND "scheduleDurationDays" IS NULL)
 OR ("scheduleCalendarId" IS NOT NULL AND "scheduleMode" IS NOT NULL AND "scheduleTimeZone" IS NOT NULL AND "scheduleDayOffset" IS NOT NULL AND "scheduleDayOffset" BETWEEN -366 AND 366 AND
   (("scheduleMode" = 'timed' AND "scheduleTime" IS NOT NULL AND "scheduleTime" ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$' AND "scheduleDurationMinutes" IS NOT NULL AND "scheduleDurationMinutes" BETWEEN 15 AND 527040 AND "scheduleDurationMinutes" % 15 = 0 AND "scheduleDurationDays" IS NULL)
    OR ("scheduleMode" = 'allDay' AND "scheduleTime" IS NULL AND "scheduleDurationMinutes" IS NULL AND "scheduleDurationDays" IS NOT NULL AND "scheduleDurationDays" BETWEEN 1 AND 366)))
);
CREATE INDEX "series_step_definitions_userId_scheduleCalendarId_idx" ON public.series_step_definitions("userId", "scheduleCalendarId");
