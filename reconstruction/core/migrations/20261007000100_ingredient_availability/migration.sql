BEGIN;
ALTER TABLE public.ingredient_preferences ADD COLUMN "trackingMode" varchar(16) NOT NULL DEFAULT 'quantity';
ALTER TABLE public.ingredient_preferences ADD CONSTRAINT ingredient_tracking_mode CHECK ("trackingMode" IN ('quantity','availability'));
ALTER TABLE public.pantry_balances ADD COLUMN available boolean NOT NULL DEFAULT false;
ALTER TABLE public.pantry_balances ADD COLUMN "availabilityReceiptId" uuid;
ALTER TABLE public.shopping_receipts ADD COLUMN "availabilityOnly" boolean NOT NULL DEFAULT false;
ALTER TABLE public.shopping_receipts ADD COLUMN "previousAvailable" boolean;
ALTER TABLE public.shopping_receipts ADD COLUMN "previousAvailabilityReceiptId" uuid;
ALTER TABLE public.shopping_receipts DROP CONSTRAINT shopping_receipt_shape;
ALTER TABLE public.shopping_receipts ADD CONSTRAINT shopping_receipt_shape CHECK (
 (("availabilityOnly" AND quantity=0 AND "previousAvailable" IS NOT NULL) OR (NOT "availabilityOnly" AND quantity>0 AND "previousAvailable" IS NULL AND "previousAvailabilityReceiptId" IS NULL))
 AND "requiredQuantity">=0 AND "optionalQuantity">=0 AND length(btrim(name))>0 AND length(btrim(unit))>0);
ALTER TABLE public.recipe_steps DROP CONSTRAINT recipe_step_valid;
ALTER TABLE public.recipe_steps ADD CONSTRAINT recipe_step_valid CHECK (
 position>=0 AND length(trim(text))>0
 AND (("ingredientId" IS NULL AND "ingredientNameSnapshot" IS NULL AND "unitSnapshot" IS NULL AND "quantityForBaseServings" IS NULL AND equivalent IS NULL)
 OR ("ingredientId" IS NOT NULL AND "ingredientNameSnapshot" IS NOT NULL AND "unitSnapshot" IS NOT NULL AND ("quantityForBaseServings" IS NULL OR "quantityForBaseServings">0)))
 AND (("minutesBefore" IS NULL AND "priorTitle" IS NULL) OR ("minutesBefore" IS NOT NULL AND "priorTitle" IS NOT NULL AND "minutesBefore" BETWEEN 1 AND 525600 AND length(trim("priorTitle"))>0)));
CREATE OR REPLACE FUNCTION public.miagenda_purchase_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r public.shopping_receipts%ROWTYPE; e public.shopping_entries%ROWTYPE; o public.inventory_operations%ROWTYPE; reversed boolean; count_lines bigint;
BEGIN
 SELECT * INTO r FROM public.shopping_receipts WHERE id=NEW.id AND "userId"=NEW."userId";
 SELECT * INTO e FROM public.shopping_entries WHERE id=r."entryId" AND "userId"=r."userId";
 SELECT * INTO o FROM public.inventory_operations WHERE id=r."operationId" AND "userId"=r."userId";
 SELECT EXISTS(SELECT 1 FROM public.inventory_operations WHERE "reversalOfId"=o.id AND "userId"=r."userId") INTO reversed;
 SELECT count(*) INTO count_lines FROM public.inventory_movements WHERE "operationId"=o.id AND "userId"=r."userId";
 IF o.kind<>'purchase' OR o."sourceKey"<>r.id OR o."sourceActivityId" IS NOT NULL OR reversed<>(r."reversedAt" IS NOT NULL) THEN RAISE EXCEPTION 'purchase_effect_invalid' USING ERRCODE='23514'; END IF;
 IF r."availabilityOnly" THEN
  IF e."ingredientId" IS NULL OR count_lines<>0 THEN RAISE EXCEPTION 'availability_purchase_effect_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  IF (e."ingredientId" IS NULL AND count_lines<>0)
   OR (e."ingredientId" IS NOT NULL AND (count_lines<>1 OR NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND "userId"=r."userId" AND "ingredientId"=e."ingredientId" AND delta=r.quantity AND unit::text=r.unit))) THEN RAISE EXCEPTION 'purchase_effect_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
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
    OR (r."availabilityOnly" AND (e."ingredientId" IS NULL OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id)))
    OR (NOT r."availabilityOnly" AND e."ingredientId" IS NOT NULL AND ((SELECT count(*) FROM public.inventory_movements WHERE "operationId"=o.id)<>1
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
