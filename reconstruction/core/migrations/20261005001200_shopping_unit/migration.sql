BEGIN;
CREATE FUNCTION public.miagenda_shopping_ingredient_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS(SELECT 1 FROM public.shopping_entries WHERE "ingredientId"=OLD.id) THEN
  RAISE EXCEPTION 'ingredient_unit_used_by_shopping' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ingredient_shopping_unit BEFORE UPDATE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.miagenda_shopping_ingredient_unit();
CREATE OR REPLACE FUNCTION public.miagenda_inventory_effect_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.inventory_operations%ROWTYPE; original public.inventory_operations%ROWTYPE; op_id uuid;
BEGIN
 IF TG_TABLE_NAME='inventory_movements' THEN op_id:=NEW."operationId"; ELSE op_id:=NEW.id; END IF;
 SELECT * INTO o FROM public.inventory_operations WHERE id=op_id AND "userId"=NEW."userId";
 IF o.kind='mealCompletion' THEN
  IF NOT EXISTS(SELECT 1 FROM public.meal_completions WHERE "operationId"=o.id AND "userId"=o."userId") OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND delta>=0) THEN RAISE EXCEPTION 'meal_inventory_effect_invalid' USING ERRCODE='23514'; END IF;
 ELSIF o.kind='purchase' THEN
  IF NOT EXISTS(SELECT 1 FROM public.shopping_receipts WHERE "operationId"=o.id AND "userId"=o."userId") OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND delta<=0) THEN RAISE EXCEPTION 'purchase_receipt_required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.shopping_receipts r JOIN public.shopping_entries e ON e.id=r."entryId" AND e."userId"=r."userId" WHERE r."operationId"=o.id AND r."userId"=o."userId" AND
   (o."sourceKey"<>r.id OR o."sourceActivityId" IS NOT NULL
    OR (e."ingredientId" IS NULL AND EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id))
    OR (e."ingredientId" IS NOT NULL AND ((SELECT count(*) FROM public.inventory_movements WHERE "operationId"=o.id)<>1
      OR NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND "ingredientId"=e."ingredientId" AND delta=r.quantity AND unit::text=r.unit))))) THEN RAISE EXCEPTION 'purchase_effect_invalid' USING ERRCODE='23514'; END IF;
 ELSIF o.kind='reversal' THEN
  SELECT * INTO original FROM public.inventory_operations WHERE id=o."reversalOfId" AND "userId"=o."userId";
  IF original.kind NOT IN ('mealCompletion','purchase') OR original."sourceActivityId" IS DISTINCT FROM o."sourceActivityId" OR original."sourceKey" <> o."sourceKey"
   OR (original.kind='mealCompletion' AND NOT EXISTS(SELECT 1 FROM public.meal_completions WHERE "operationId"=original.id AND "userId"=o."userId" AND "reversedAt" IS NOT NULL))
   OR (original.kind='purchase' AND NOT EXISTS(SELECT 1 FROM public.shopping_receipts WHERE "operationId"=original.id AND "userId"=o."userId" AND "reversedAt" IS NOT NULL))
   OR EXISTS(SELECT 1 FROM public.inventory_movements original_line LEFT JOIN public.inventory_movements reversal_line ON reversal_line."ingredientId"=original_line."ingredientId" AND reversal_line."operationId"=o.id WHERE original_line."operationId"=original.id AND (reversal_line.delta IS DISTINCT FROM -original_line.delta OR reversal_line.unit IS DISTINCT FROM original_line.unit))
   OR (SELECT count(*) FROM public.inventory_movements WHERE "operationId"=o.id) <> (SELECT count(*) FROM public.inventory_movements WHERE "operationId"=original.id) THEN RAISE EXCEPTION 'inventory_reversal_not_exact' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;

COMMIT;