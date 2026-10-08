-- Personal classifications reference planner rows by stable identity, not name.
CREATE TABLE public.recipe_meal_slots (
  "recipeId" UUID NOT NULL,
  "slotId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  CONSTRAINT recipe_meal_slots_pkey PRIMARY KEY ("recipeId", "slotId"),
  CONSTRAINT "recipe_meal_slots_recipeId_userId_fkey" FOREIGN KEY ("recipeId", "userId") REFERENCES public.recipes(id, "userId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "recipe_meal_slots_slotId_userId_fkey" FOREIGN KEY ("slotId", "userId") REFERENCES public.meal_slots(id, "userId") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "recipe_meal_slots_slotId_userId_idx" ON public.recipe_meal_slots ("slotId", "userId");
CREATE FUNCTION public.miagenda_recipe_classification_write() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'recipe_classification_identity_fixed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.miagenda_touch_owner(OLD."userId");
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = NEW."recipeId" AND "userId" = NEW."userId" AND "retiredAt" IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.meal_slots WHERE id = NEW."slotId" AND "userId" = NEW."userId" AND "retiredAt" IS NULL) THEN
    RAISE EXCEPTION 'recipe_classification_unavailable' USING ERRCODE = '23514';
  END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId");
  RETURN NEW;
END $$;
CREATE TRIGGER recipe_classification_write BEFORE INSERT OR UPDATE OR DELETE ON public.recipe_meal_slots FOR EACH ROW EXECUTE FUNCTION public.miagenda_recipe_classification_write();
