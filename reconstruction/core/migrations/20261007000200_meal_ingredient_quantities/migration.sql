BEGIN;
ALTER TABLE public.meal_recipes ADD COLUMN "ingredientQuantities" jsonb;
ALTER TABLE public.meal_recipes ADD CONSTRAINT meal_ingredient_quantities_object CHECK ("ingredientQuantities" IS NULL OR jsonb_typeof("ingredientQuantities") = 'object');
CREATE FUNCTION public.miagenda_meal_amounts_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE item record; count_items integer := 0;
BEGIN
 IF NEW."ingredientQuantities" IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW."ingredientQuantities") <> 'object' THEN RAISE EXCEPTION 'meal_amounts_object' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(NEW."ingredientQuantities") LOOP
  count_items := count_items + 1;
  IF count_items>120 OR jsonb_typeof(item.value)<>'string' OR (item.value #>> '{}') !~ '^\d{1,9}(\.\d{1,3})?$' THEN RAISE EXCEPTION 'meal_amount_invalid' USING ERRCODE='23514'; END IF;
  IF (item.value #>> '{}')::numeric<=0 OR (item.value #>> '{}')::numeric>999999999.999 THEN RAISE EXCEPTION 'meal_amount_invalid' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.recipe_steps s WHERE s."recipeRevisionId"=NEW."recipeRevisionId" AND s."userId"=NEW."userId" AND s."quantityForBaseServings" IS NOT NULL AND item.key=s."ingredientId"::text||':'||CASE WHEN s.optional THEN 'optional' ELSE 'required' END) THEN RAISE EXCEPTION 'meal_amount_ingredient_invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER meal_amounts_write BEFORE INSERT OR UPDATE ON public.meal_recipes FOR EACH ROW EXECUTE FUNCTION public.miagenda_meal_amounts_write();
COMMIT;
