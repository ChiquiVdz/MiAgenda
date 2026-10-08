ALTER TABLE public.activities DROP CONSTRAINT activities_core_task_only;
ALTER TABLE public.activities ADD CONSTRAINT meals_pending_until_inventory CHECK (kind <> 'meal' OR ("parentId" IS NULL AND "completedAt" IS NULL AND "occurrenceId" IS NULL));
ALTER TABLE public.meal_slots ADD CONSTRAINT meal_slot_values CHECK (length(trim(name)) > 0 AND position >= 0 AND revision >= 0 AND "startMinute" BETWEEN 0 AND 1439 AND "startMinute" % 15 = 0);
ALTER TABLE public.meal_blocks ADD CONSTRAINT meal_block_values CHECK (("cookingEnabled" OR "eatingEnabled" OR "washingEnabled") AND "eatingMinutes" BETWEEN 0 AND 1440 AND "washingMinutes" BETWEEN 0 AND 1440 AND ("cookingMinutesOverride" IS NULL OR "cookingMinutesOverride" BETWEEN 1 AND 10080) AND ("durationMinutesOverride" IS NULL OR "durationMinutesOverride" BETWEEN 1 AND 12960));
ALTER TABLE public.meal_recipes ADD CONSTRAINT meal_recipe_values CHECK (position >= 0 AND "cookedServings" >= 0 AND "eatenServings" >= 0 AND ("cookedServings" > 0 OR "eatenServings" > 0) AND ("cookingMinutesOverride" IS NULL OR "cookingMinutesOverride" BETWEEN 1 AND 10080));
ALTER TABLE public.meal_step_data ADD CONSTRAINT meal_step_values CHECK (("quantityPerServing" IS NULL OR "quantityPerServing" >= 0) AND ("suggestedMinutesBefore" IS NULL OR "suggestedMinutesBefore" > 0));
CREATE FUNCTION public.miagenda_planner_write() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_id uuid; parent_id uuid;
BEGIN
  owner_id := CASE WHEN TG_OP='DELETE' THEN OLD."userId" ELSE NEW."userId" END;
  PERFORM public.miagenda_touch_owner(owner_id);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW."userId" IS DISTINCT FROM OLD."userId" THEN RAISE EXCEPTION 'planner_owner_fixed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='meal_slots' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.id <> OLD.id THEN RAISE EXCEPTION 'slot_identity_fixed' USING ERRCODE='23514'; END IF;
      NEW.revision := OLD.revision+1;
    END IF;
  ELSIF TG_TABLE_NAME='meal_recipes' THEN
    IF NOT EXISTS (SELECT 1 FROM public.recipe_revisions WHERE id=NEW."recipeRevisionId" AND "userId"=owner_id AND NOT draft) THEN RAISE EXCEPTION 'plan_requires_ready_recipe' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='meal_step_data' THEN
    SELECT "blockId" INTO parent_id FROM public.meal_recipes WHERE id=NEW."mealRecipeId" AND "userId"=owner_id;
    IF NOT EXISTS (SELECT 1 FROM public.activities WHERE id=NEW."activityId" AND "userId"=owner_id AND "parentId"=parent_id AND kind='task') THEN RAISE EXCEPTION 'meal_step_parent_invalid' USING ERRCODE='23514'; END IF;
    IF NEW."ingredientId" IS NOT NULL AND NOT public.miagenda_ingredient_access(owner_id, NEW."ingredientId") THEN RAISE EXCEPTION 'meal_ingredient_access' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planner_slot_write BEFORE INSERT OR UPDATE OR DELETE ON public.meal_slots FOR EACH ROW EXECUTE FUNCTION public.miagenda_planner_write();
CREATE TRIGGER planner_block_write BEFORE INSERT OR UPDATE OR DELETE ON public.meal_blocks FOR EACH ROW EXECUTE FUNCTION public.miagenda_planner_write();
CREATE TRIGGER planner_cell_write BEFORE INSERT OR UPDATE OR DELETE ON public.meal_cells FOR EACH ROW EXECUTE FUNCTION public.miagenda_planner_write();
CREATE TRIGGER planner_recipe_write BEFORE INSERT OR UPDATE OR DELETE ON public.meal_recipes FOR EACH ROW EXECUTE FUNCTION public.miagenda_planner_write();
CREATE TRIGGER planner_step_write BEFORE INSERT OR UPDATE OR DELETE ON public.meal_step_data FOR EACH ROW EXECUTE FUNCTION public.miagenda_planner_write();
CREATE FUNCTION public.miagenda_meal_final() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE a public.activities%ROWTYPE; s public.activity_schedules%ROWTYPE; c public.meal_cells%ROWTYPE; key_id uuid; owner_id uuid;
BEGIN
  IF TG_TABLE_NAME='activities' THEN
    key_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME='meal_cells' THEN
    key_id := CASE WHEN TG_OP='DELETE' THEN OLD."blockId" ELSE NEW."blockId" END;
  ELSE key_id := CASE WHEN TG_OP='DELETE' THEN OLD."activityId" ELSE NEW."activityId" END;
  END IF;
  owner_id := CASE WHEN TG_OP='DELETE' THEN OLD."userId" ELSE NEW."userId" END;
  SELECT * INTO a FROM public.activities WHERE id=key_id AND "userId"=owner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF a.kind='meal' AND a.lifecycle='active' THEN
    SELECT * INTO s FROM public.activity_schedules WHERE "activityId"=a.id AND "userId"=owner_id;
    SELECT * INTO c FROM public.meal_cells WHERE "blockId"=a.id AND "userId"=owner_id;
    IF s."activityId" IS NULL OR s.mode <> 'timed' OR c."blockId" IS NULL OR c."planningDate" <> (s."startsAt" AT TIME ZONE s."timeZone")::date
      OR NOT EXISTS (SELECT 1 FROM public.calendars WHERE id=s."calendarId" AND "userId"=owner_id AND "moduleKey"='kitchen')
      OR NOT EXISTS (SELECT 1 FROM public.meal_slots WHERE id=c."slotId" AND "userId"=owner_id AND "retiredAt" IS NULL)
      OR NOT EXISTS (SELECT 1 FROM public.meal_recipes WHERE "blockId"=a.id AND "userId"=owner_id) THEN RAISE EXCEPTION 'meal_schedule_cell_required' USING ERRCODE='23514'; END IF;
  END IF;
  IF a."completedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM public.meal_step_data WHERE "activityId"=a.id AND "userId"=owner_id AND role='preparation') THEN RAISE EXCEPTION 'meal_completion_pending_inventory' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER meal_activity_final AFTER INSERT OR UPDATE OR DELETE ON public.activities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_meal_final();
CREATE CONSTRAINT TRIGGER meal_schedule_final AFTER INSERT OR UPDATE OR DELETE ON public.activity_schedules DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_meal_final();
CREATE CONSTRAINT TRIGGER meal_cell_final AFTER INSERT OR UPDATE OR DELETE ON public.meal_cells DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_meal_final();
