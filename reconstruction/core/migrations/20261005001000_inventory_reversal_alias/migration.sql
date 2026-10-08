-- Avoid OLD/NEW trigger variables as SQL table aliases.
BEGIN;
CREATE OR REPLACE FUNCTION public.miagenda_inventory_effect_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.inventory_operations%ROWTYPE; original public.inventory_operations%ROWTYPE; op_id uuid;
BEGIN
  IF TG_TABLE_NAME='inventory_movements' THEN op_id:=NEW."operationId"; ELSE op_id:=NEW.id; END IF;
  SELECT * INTO o FROM public.inventory_operations WHERE id=op_id AND "userId"=NEW."userId";
  IF o.kind='mealCompletion' THEN
    IF NOT EXISTS(SELECT 1 FROM public.meal_completions WHERE "operationId"=o.id AND "userId"=o."userId") OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND delta>=0) THEN RAISE EXCEPTION 'meal_inventory_effect_invalid' USING ERRCODE='23514'; END IF;
  ELSIF o.kind='reversal' THEN
    SELECT * INTO original FROM public.inventory_operations WHERE id=o."reversalOfId" AND "userId"=o."userId";
    IF original.kind <> 'mealCompletion' OR original."sourceActivityId" <> o."sourceActivityId" OR NOT EXISTS(SELECT 1 FROM public.meal_completions WHERE "operationId"=original.id AND "reversedAt" IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.inventory_movements original_line LEFT JOIN public.inventory_movements reversal_line ON reversal_line."ingredientId"=original_line."ingredientId" AND reversal_line."operationId"=o.id WHERE original_line."operationId"=original.id AND (reversal_line.delta IS DISTINCT FROM -original_line.delta OR reversal_line.unit IS DISTINCT FROM original_line.unit))
      OR (SELECT count(*) FROM public.inventory_movements WHERE "operationId"=o.id) <> (SELECT count(*) FROM public.inventory_movements WHERE "operationId"=original.id)
      THEN RAISE EXCEPTION 'inventory_reversal_not_exact' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
COMMIT;
