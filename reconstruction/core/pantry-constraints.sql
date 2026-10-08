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
