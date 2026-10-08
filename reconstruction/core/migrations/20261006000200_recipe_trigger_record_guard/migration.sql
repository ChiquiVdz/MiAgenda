-- Recipe/Revision/Step share this trigger, but only Step has ingredientId.
-- Guard the record type in its own branch: PostgreSQL resolves record fields
-- while preparing an expression, before boolean short-circuiting can help.
BEGIN;
CREATE OR REPLACE FUNCTION public.miagenda_recipe_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'recipe_evidence_immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='recipes' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.id<>OLD.id OR NEW."userId"<>OLD."userId" THEN RAISE EXCEPTION 'recipe_identity_fixed' USING ERRCODE='23514'; END IF;
      NEW.revision:=OLD.revision+1;
    END IF;
  ELSE
    IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'recipe_version_immutable' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='recipe_steps' THEN
      IF NEW."ingredientId" IS NOT NULL THEN
        IF NOT public.miagenda_ingredient_access(NEW."userId",NEW."ingredientId")
          OR NOT EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id=NEW."ingredientId" AND i.unit=NEW."unitSnapshot")
          OR NOT (
            EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id=NEW."ingredientId" AND i.name=NEW."ingredientNameSnapshot")
            OR EXISTS (SELECT 1 FROM public.recipe_steps s WHERE s."userId"=NEW."userId" AND s."ingredientId"=NEW."ingredientId"
              AND s."unitSnapshot"=NEW."unitSnapshot" AND s."ingredientNameSnapshot"=NEW."ingredientNameSnapshot")
          ) THEN RAISE EXCEPTION 'recipe_ingredient_access' USING ERRCODE='23514'; END IF;
      END IF;
    END IF;
  END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId");
  RETURN NEW;
END $$;
COMMIT;
