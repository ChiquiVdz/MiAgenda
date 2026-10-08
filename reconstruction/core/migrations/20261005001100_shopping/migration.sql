BEGIN;
-- CreateTable
CREATE TABLE "shopping_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ingredientId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "free" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL(12,3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopping_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_receipts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "requiredQuantity" DECIMAL(12,3) NOT NULL,
    "optionalQuantity" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),

    CONSTRAINT "shopping_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shopping_entries_userId_retiredAt_closedAt_idx" ON "shopping_entries"("userId", "retiredAt", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_entries_id_userId_key" ON "shopping_entries"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_receipts_operationId_key" ON "shopping_receipts"("operationId");

-- CreateIndex
CREATE INDEX "shopping_receipts_userId_createdAt_id_idx" ON "shopping_receipts"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_receipts_id_userId_key" ON "shopping_receipts"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_receipts_operationId_userId_key" ON "shopping_receipts"("operationId", "userId");

-- AddForeignKey
ALTER TABLE "shopping_entries" ADD CONSTRAINT "shopping_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shopping_entries" ADD CONSTRAINT "shopping_entries_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shopping_receipts" ADD CONSTRAINT "shopping_receipts_entryId_userId_fkey" FOREIGN KEY ("entryId", "userId") REFERENCES "shopping_entries"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shopping_receipts" ADD CONSTRAINT "shopping_receipts_operationId_userId_fkey" FOREIGN KEY ("operationId", "userId") REFERENCES "inventory_operations"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE public.shopping_entries ADD CONSTRAINT shopping_entry_shape CHECK (revision >= 0 AND length(btrim(name)) > 0 AND length(btrim(unit)) > 0 AND (quantity IS NULL OR quantity >= 0) AND ((free AND quantity IS NOT NULL AND quantity > 0) OR (NOT free AND "ingredientId" IS NOT NULL AND "closedAt" IS NULL)));
CREATE UNIQUE INDEX shopping_calculated_ingredient ON public.shopping_entries ("userId", "ingredientId") WHERE NOT free AND "retiredAt" IS NULL;
ALTER TABLE public.shopping_receipts ADD CONSTRAINT shopping_receipt_shape CHECK (quantity > 0 AND "requiredQuantity" >= 0 AND "optionalQuantity" >= 0 AND length(btrim(name)) > 0 AND length(btrim(unit)) > 0);
ALTER TABLE public.inventory_operations DROP CONSTRAINT inventory_operation_shape;
ALTER TABLE public.inventory_operations ADD CONSTRAINT inventory_operation_shape CHECK (
 (kind='adjustment' AND "sourceActivityId" IS NULL AND "reversalOfId" IS NULL AND "sourceRevision" IS NOT NULL AND "sourceRevision">=0)
 OR (kind='mealCompletion' AND "sourceActivityId" IS NOT NULL AND "reversalOfId" IS NULL AND "sourceRevision" IS NOT NULL AND "sourceRevision">=0)
 OR (kind='purchase' AND "sourceActivityId" IS NULL AND "reversalOfId" IS NULL AND "sourceRevision" IS NOT NULL AND "sourceRevision">=0)
 OR (kind='reversal' AND "reversalOfId" IS NOT NULL AND "sourceRevision" IS NOT NULL AND "sourceRevision">=0)
);
CREATE FUNCTION public.miagenda_shopping_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'shopping_evidence_retained' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='shopping_receipts' THEN
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'reversedAt') IS DISTINCT FROM (to_jsonb(OLD)-'reversedAt') OR OLD."reversedAt" IS NOT NULL OR NEW."reversedAt" IS NULL) THEN RAISE EXCEPTION 'purchase_receipt_immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW."userId",NEW."ingredientId",NEW.free,NEW.name,NEW.unit,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."userId",OLD."ingredientId",OLD.free,OLD.name,OLD.unit,OLD."createdAt") THEN RAISE EXCEPTION 'shopping_identity_fixed' USING ERRCODE='23514'; END IF;
   NEW.revision:=OLD.revision+1;
  END IF;
  IF NEW."ingredientId" IS NOT NULL AND (NOT public.miagenda_ingredient_access(NEW."userId",NEW."ingredientId") OR NOT EXISTS(SELECT 1 FROM public.ingredients WHERE id=NEW."ingredientId" AND unit::text=NEW.unit)) THEN RAISE EXCEPTION 'shopping_ingredient_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM public.miagenda_touch_owner(NEW."userId");
 RETURN NEW;
END $$;
CREATE TRIGGER shopping_entry_revision BEFORE INSERT OR UPDATE OR DELETE ON public.shopping_entries FOR EACH ROW EXECUTE FUNCTION public.miagenda_shopping_write();
CREATE TRIGGER shopping_receipt_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.shopping_receipts FOR EACH ROW EXECUTE FUNCTION public.miagenda_shopping_write();

CREATE FUNCTION public.miagenda_purchase_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r public.shopping_receipts%ROWTYPE; e public.shopping_entries%ROWTYPE; o public.inventory_operations%ROWTYPE; reversed boolean; count_lines bigint;
BEGIN
 SELECT * INTO r FROM public.shopping_receipts WHERE id=NEW.id AND "userId"=NEW."userId";
 SELECT * INTO e FROM public.shopping_entries WHERE id=r."entryId" AND "userId"=r."userId";
 SELECT * INTO o FROM public.inventory_operations WHERE id=r."operationId" AND "userId"=r."userId";
 SELECT EXISTS(SELECT 1 FROM public.inventory_operations WHERE "reversalOfId"=o.id AND "userId"=r."userId") INTO reversed;
 SELECT count(*) INTO count_lines FROM public.inventory_movements WHERE "operationId"=o.id AND "userId"=r."userId";
 IF o.kind <> 'purchase' OR o."sourceKey" <> r.id OR o."sourceActivityId" IS NOT NULL OR reversed <> (r."reversedAt" IS NOT NULL)
  OR (e."ingredientId" IS NULL AND count_lines<>0)
  OR (e."ingredientId" IS NOT NULL AND (count_lines<>1 OR NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND "userId"=r."userId" AND "ingredientId"=e."ingredientId" AND delta=r.quantity AND unit::text=r.unit))) THEN
  RAISE EXCEPTION 'purchase_effect_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER shopping_purchase_final AFTER INSERT OR UPDATE ON public.shopping_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_purchase_final();

CREATE OR REPLACE FUNCTION public.miagenda_inventory_effect_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.inventory_operations%ROWTYPE; original public.inventory_operations%ROWTYPE; op_id uuid;
BEGIN
 IF TG_TABLE_NAME='inventory_movements' THEN op_id:=NEW."operationId"; ELSE op_id:=NEW.id; END IF;
 SELECT * INTO o FROM public.inventory_operations WHERE id=op_id AND "userId"=NEW."userId";
 IF o.kind='mealCompletion' THEN
  IF NOT EXISTS(SELECT 1 FROM public.meal_completions WHERE "operationId"=o.id AND "userId"=o."userId") OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND delta>=0) THEN RAISE EXCEPTION 'meal_inventory_effect_invalid' USING ERRCODE='23514'; END IF;
 ELSIF o.kind='purchase' THEN
  IF NOT EXISTS(SELECT 1 FROM public.shopping_receipts WHERE "operationId"=o.id AND "userId"=o."userId") OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND delta<=0) THEN RAISE EXCEPTION 'purchase_receipt_required' USING ERRCODE='23514'; END IF;
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
