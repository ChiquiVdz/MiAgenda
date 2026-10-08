-- Canonical units are fixed once referenced by immutable recipe versions.
CREATE FUNCTION public.miagenda_recipe_ingredient_unit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS (SELECT 1 FROM public.recipe_steps WHERE "ingredientId"=OLD.id) THEN
    RAISE EXCEPTION 'ingredient_unit_used_by_recipe' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ingredient_recipe_unit BEFORE UPDATE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.miagenda_recipe_ingredient_unit();
