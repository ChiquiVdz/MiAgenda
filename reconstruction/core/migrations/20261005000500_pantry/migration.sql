-- CreateEnum
CREATE TYPE "IngredientUnit" AS ENUM ('g', 'ml', 'piece');

-- CreateEnum
CREATE TYPE "IngredientScope" AS ENUM ('global', 'private');

-- CreateEnum
CREATE TYPE "InventoryOperationKind" AS ENUM ('mealCompletion', 'purchase', 'adjustment', 'reversal');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "scope" "IngredientScope" NOT NULL,
    "ownerUserId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(120) NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_preferences" (
    "userId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "retiredForUser" BOOLEAN NOT NULL DEFAULT false,
    "replacementId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ingredient_preferences_pkey" PRIMARY KEY ("userId","ingredientId")
);

-- CreateTable
CREATE TABLE "pantry_balances" (
    "userId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pantry_balances_pkey" PRIMARY KEY ("userId","ingredientId")
);

-- CreateTable
CREATE TABLE "inventory_operations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "InventoryOperationKind" NOT NULL,
    "commandId" UUID NOT NULL,
    "sourceKey" UUID NOT NULL,
    "sourceActivityId" UUID,
    "sourceRevision" INTEGER,
    "reversalOfId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "delta" DECIMAL(12,3) NOT NULL,
    "unit" "IngredientUnit" NOT NULL,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredients_scope_normalizedName_idx" ON "ingredients"("scope", "normalizedName");

-- CreateIndex
CREATE INDEX "ingredients_ownerUserId_normalizedName_idx" ON "ingredients"("ownerUserId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_operations_reversalOfId_key" ON "inventory_operations"("reversalOfId");

-- CreateIndex
CREATE INDEX "inventory_operations_userId_commandId_idx" ON "inventory_operations"("userId", "commandId");

-- CreateIndex
CREATE INDEX "inventory_operations_userId_sourceKey_createdAt_idx" ON "inventory_operations"("userId", "sourceKey", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_operations_sourceActivityId_idx" ON "inventory_operations"("sourceActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_operations_id_userId_key" ON "inventory_operations"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_operations_reversalOfId_userId_key" ON "inventory_operations"("reversalOfId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_operations_userId_commandId_sourceKey_kind_key" ON "inventory_operations"("userId", "commandId", "sourceKey", "kind");

-- CreateIndex
CREATE INDEX "inventory_movements_userId_ingredientId_idx" ON "inventory_movements"("userId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_operationId_ingredientId_key" ON "inventory_movements"("operationId", "ingredientId");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ingredient_preferences" ADD CONSTRAINT "ingredient_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ingredient_preferences" ADD CONSTRAINT "ingredient_preferences_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ingredient_preferences" ADD CONSTRAINT "ingredient_preferences_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pantry_balances" ADD CONSTRAINT "pantry_balances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pantry_balances" ADD CONSTRAINT "pantry_balances_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_operations" ADD CONSTRAINT "inventory_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_operations" ADD CONSTRAINT "inventory_operations_sourceActivityId_userId_fkey" FOREIGN KEY ("sourceActivityId", "userId") REFERENCES "activities"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_operations" ADD CONSTRAINT "inventory_operations_reversalOfId_userId_fkey" FOREIGN KEY ("reversalOfId", "userId") REFERENCES "inventory_operations"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_operationId_userId_fkey" FOREIGN KEY ("operationId", "userId") REFERENCES "inventory_operations"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- Appended once to the forward migration; not run separately.
ALTER TABLE public.ingredients ADD CONSTRAINT ingredient_shape CHECK (
  ((scope = 'global' AND "ownerUserId" IS NULL) OR (scope = 'private' AND "ownerUserId" IS NOT NULL))
  AND length(btrim(name)) > 0 AND length(btrim("normalizedName")) > 0 AND revision >= 0
);
CREATE UNIQUE INDEX ingredient_global_name ON public.ingredients ("normalizedName") WHERE scope = 'global' AND "retiredAt" IS NULL;
CREATE UNIQUE INDEX ingredient_private_name ON public.ingredients ("ownerUserId", "normalizedName") WHERE scope = 'private' AND "retiredAt" IS NULL;
ALTER TABLE public.ingredient_preferences ADD CONSTRAINT ingredient_preference_shape CHECK (revision >= 0 AND ("replacementId" IS NULL OR "replacementId" <> "ingredientId"));
ALTER TABLE public.pantry_balances ADD CONSTRAINT pantry_balance_values CHECK (quantity >= 0 AND revision >= 0);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movement_values CHECK (delta <> 0);
-- This block implements adjustments only; replace the gate with each future operation.
ALTER TABLE public.inventory_operations ADD CONSTRAINT inventory_adjustment_only CHECK (kind = 'adjustment' AND "sourceActivityId" IS NULL AND "reversalOfId" IS NULL AND "sourceRevision" IS NOT NULL AND "sourceRevision" >= 0);

CREATE FUNCTION public.miagenda_ingredient_access(owner_id uuid, ingredient_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.ingredients WHERE id = ingredient_id AND "retiredAt" IS NULL
    AND (scope = 'global' OR "ownerUserId" = owner_id));
$fn$;

CREATE FUNCTION public.miagenda_ingredient_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Ingredient identities must be retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.scope, NEW."ownerUserId") IS DISTINCT FROM (OLD.id, OLD.scope, OLD."ownerUserId") THEN
      RAISE EXCEPTION 'Ingredient identity and owner are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.unit IS DISTINCT FROM OLD.unit AND (EXISTS (SELECT 1 FROM public.inventory_movements WHERE "ingredientId" = NEW.id)
      OR EXISTS (SELECT 1 FROM public.pantry_balances WHERE "ingredientId" = NEW.id AND quantity <> 0)) THEN
      RAISE EXCEPTION 'Unit is fixed after inventory use' USING ERRCODE = '23514';
    END IF;
    NEW.revision := OLD.revision + 1;
  ELSE NEW.revision := 0; END IF;
  IF NEW.scope = 'private' THEN
    PERFORM public.miagenda_touch_owner(NEW."ownerUserId");
    IF NEW."retiredAt" IS NULL AND EXISTS (SELECT 1 FROM public.ingredients WHERE scope = 'global' AND "retiredAt" IS NULL AND "normalizedName" = NEW."normalizedName") THEN
      RAISE EXCEPTION 'Use the existing global ingredient' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER ingredient_identity_unit BEFORE INSERT OR UPDATE OR DELETE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.miagenda_ingredient_write();

CREATE FUNCTION public.miagenda_stock_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Inventory evidence must be retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME IN ('inventory_operations', 'inventory_movements') THEN RAISE EXCEPTION 'Inventory evidence is immutable' USING ERRCODE = '23514'; END IF;
    IF (NEW."userId", NEW."ingredientId") IS DISTINCT FROM (OLD."userId", OLD."ingredientId") THEN
      RAISE EXCEPTION 'Stock identity and owner are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId");
  IF TG_TABLE_NAME <> 'inventory_operations' THEN
    IF NOT public.miagenda_ingredient_access(NEW."userId", NEW."ingredientId") THEN
      RAISE EXCEPTION 'Ingredient is unavailable for owner' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'pantry_balances' THEN
    NEW.revision := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.revision + 1 END;
    NEW."updatedAt" := clock_timestamp();
  ELSIF TG_TABLE_NAME = 'ingredient_preferences' THEN
    NEW.revision := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.revision + 1 END;
    IF NEW."replacementId" IS NOT NULL AND NOT public.miagenda_ingredient_access(NEW."userId", NEW."replacementId") THEN
      RAISE EXCEPTION 'Replacement unavailable for owner' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory_movements' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ingredients WHERE id = NEW."ingredientId" AND unit = NEW.unit) THEN
      RAISE EXCEPTION 'Movement unit differs from ingredient' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.pantry_balances ("userId", "ingredientId", quantity, listed, "updatedAt")
      VALUES (NEW."userId", NEW."ingredientId", 0, true, clock_timestamp())
      ON CONFLICT ("userId", "ingredientId") DO NOTHING;
    UPDATE public.pantry_balances SET quantity = quantity + NEW.delta
      WHERE "userId" = NEW."userId" AND "ingredientId" = NEW."ingredientId";
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER pantry_revision_access BEFORE INSERT OR UPDATE OR DELETE ON public.pantry_balances FOR EACH ROW EXECUTE FUNCTION public.miagenda_stock_write();
CREATE TRIGGER ingredient_preference_revision BEFORE INSERT OR UPDATE OR DELETE ON public.ingredient_preferences FOR EACH ROW EXECUTE FUNCTION public.miagenda_stock_write();
CREATE TRIGGER inventory_operation_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_operations FOR EACH ROW EXECUTE FUNCTION public.miagenda_stock_write();
CREATE TRIGGER inventory_movement_apply BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.miagenda_stock_write();

CREATE FUNCTION public.miagenda_stock_final() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE actual numeric; evidence numeric;
BEGIN
  SELECT quantity INTO actual FROM public.pantry_balances WHERE "userId" = NEW."userId" AND "ingredientId" = NEW."ingredientId";
  SELECT coalesce(sum(delta), 0) INTO evidence FROM public.inventory_movements WHERE "userId" = NEW."userId" AND "ingredientId" = NEW."ingredientId";
  IF actual IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'Stock must match immutable movements' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER pantry_ledger_integrity AFTER INSERT OR UPDATE ON public.pantry_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_stock_final();

INSERT INTO public.ingredients (id, scope, name, "normalizedName", unit) VALUES
('c0a10000-0000-5000-8000-000000000001', 'global', 'Arroz', 'arroz', 'g'),
('c0a10000-0000-5000-8000-000000000002', 'global', 'Leche', 'leche', 'ml'),
('c0a10000-0000-5000-8000-000000000003', 'global', 'Azúcar', 'azucar', 'g'),
('c0a10000-0000-5000-8000-000000000004', 'global', 'Sal', 'sal', 'g'),
('c0a10000-0000-5000-8000-000000000005', 'global', 'Harina de trigo', 'harina de trigo', 'g'),
('c0a10000-0000-5000-8000-000000000006', 'global', 'Pasta', 'pasta', 'g'),
('c0a10000-0000-5000-8000-000000000007', 'global', 'Frijol', 'frijol', 'g'),
('c0a10000-0000-5000-8000-000000000008', 'global', 'Lenteja', 'lenteja', 'g'),
('c0a10000-0000-5000-8000-000000000009', 'global', 'Avena', 'avena', 'g'),
('c0a10000-0000-5000-8000-000000000010', 'global', 'Aceite', 'aceite', 'ml'),
('c0a10000-0000-5000-8000-000000000011', 'global', 'Mantequilla', 'mantequilla', 'g'),
('c0a10000-0000-5000-8000-000000000012', 'global', 'Huevo', 'huevo', 'piece'),
('c0a10000-0000-5000-8000-000000000013', 'global', 'Pollo', 'pollo', 'g'),
('c0a10000-0000-5000-8000-000000000014', 'global', 'Carne de res', 'carne de res', 'g'),
('c0a10000-0000-5000-8000-000000000015', 'global', 'Carne molida', 'carne molida', 'g'),
('c0a10000-0000-5000-8000-000000000016', 'global', 'Atún', 'atun', 'g'),
('c0a10000-0000-5000-8000-000000000017', 'global', 'Queso', 'queso', 'g'),
('c0a10000-0000-5000-8000-000000000018', 'global', 'Jitomate', 'jitomate', 'g'),
('c0a10000-0000-5000-8000-000000000019', 'global', 'Cebolla', 'cebolla', 'g'),
('c0a10000-0000-5000-8000-000000000020', 'global', 'Ajo', 'ajo', 'g'),
('c0a10000-0000-5000-8000-000000000021', 'global', 'Papa', 'papa', 'g'),
('c0a10000-0000-5000-8000-000000000022', 'global', 'Zanahoria', 'zanahoria', 'g'),
('c0a10000-0000-5000-8000-000000000023', 'global', 'Limón', 'limon', 'piece'),
('c0a10000-0000-5000-8000-000000000024', 'global', 'Chile serrano', 'chile serrano', 'piece'),
('c0a10000-0000-5000-8000-000000000025', 'global', 'Chile jalapeño', 'chile jalapeno', 'piece'),
('c0a10000-0000-5000-8000-000000000026', 'global', 'Cilantro', 'cilantro', 'g'),
('c0a10000-0000-5000-8000-000000000027', 'global', 'Lechuga', 'lechuga', 'piece'),
('c0a10000-0000-5000-8000-000000000028', 'global', 'Tortilla', 'tortilla', 'piece'),
('c0a10000-0000-5000-8000-000000000029', 'global', 'Pan', 'pan', 'piece'),
('c0a10000-0000-5000-8000-000000000030', 'global', 'Yogur', 'yogur', 'g'),
('c0a10000-0000-5000-8000-000000000031', 'global', 'Crema', 'crema', 'ml'),
('c0a10000-0000-5000-8000-000000000032', 'global', 'Pimiento', 'pimiento', 'piece'),
('c0a10000-0000-5000-8000-000000000033', 'global', 'Pepino', 'pepino', 'piece'),
('c0a10000-0000-5000-8000-000000000034', 'global', 'Espinaca', 'espinaca', 'g'),
('c0a10000-0000-5000-8000-000000000035', 'global', 'Champiñón', 'champinon', 'g'),
('c0a10000-0000-5000-8000-000000000036', 'global', 'Aguacate', 'aguacate', 'piece'),
('c0a10000-0000-5000-8000-000000000037', 'global', 'Manzana', 'manzana', 'piece'),
('c0a10000-0000-5000-8000-000000000038', 'global', 'Plátano', 'platano', 'piece'),
('c0a10000-0000-5000-8000-000000000039', 'global', 'Naranja', 'naranja', 'piece'),
('c0a10000-0000-5000-8000-000000000040', 'global', 'Agua', 'agua', 'ml'),
('c0a10000-0000-5000-8000-000000000041', 'global', 'Vinagre', 'vinagre', 'ml');
