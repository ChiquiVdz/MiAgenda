BEGIN;
-- CreateTable
CREATE TABLE "meal_completions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "optionalSteps" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),

    CONSTRAINT "meal_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cooked_batches" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completionId" UUID NOT NULL,
    "recipeRevisionId" UUID NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "cooked_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portion_uses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completionId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),

    CONSTRAINT "portion_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_completions_operationId_key" ON "meal_completions"("operationId");

-- CreateIndex
CREATE INDEX "meal_completions_userId_blockId_createdAt_idx" ON "meal_completions"("userId", "blockId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "meal_completions_id_userId_key" ON "meal_completions"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_completions_operationId_userId_key" ON "meal_completions"("operationId", "userId");

-- CreateIndex
CREATE INDEX "cooked_batches_userId_revokedAt_createdAt_idx" ON "cooked_batches"("userId", "revokedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cooked_batches_id_userId_key" ON "cooked_batches"("id", "userId");

-- CreateIndex
CREATE INDEX "portion_uses_userId_batchId_reversedAt_idx" ON "portion_uses"("userId", "batchId", "reversedAt");

-- CreateIndex
CREATE UNIQUE INDEX "portion_uses_completionId_batchId_key" ON "portion_uses"("completionId", "batchId");

-- AddForeignKey
ALTER TABLE "meal_completions" ADD CONSTRAINT "meal_completions_blockId_userId_fkey" FOREIGN KEY ("blockId", "userId") REFERENCES "meal_blocks"("activityId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_completions" ADD CONSTRAINT "meal_completions_operationId_userId_fkey" FOREIGN KEY ("operationId", "userId") REFERENCES "inventory_operations"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cooked_batches" ADD CONSTRAINT "cooked_batches_completionId_userId_fkey" FOREIGN KEY ("completionId", "userId") REFERENCES "meal_completions"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cooked_batches" ADD CONSTRAINT "cooked_batches_recipeRevisionId_userId_fkey" FOREIGN KEY ("recipeRevisionId", "userId") REFERENCES "recipe_revisions"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "portion_uses" ADD CONSTRAINT "portion_uses_completionId_userId_fkey" FOREIGN KEY ("completionId", "userId") REFERENCES "meal_completions"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "portion_uses" ADD CONSTRAINT "portion_uses_batchId_userId_fkey" FOREIGN KEY ("batchId", "userId") REFERENCES "cooked_batches"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE public.activities DROP CONSTRAINT meals_pending_until_inventory;
ALTER TABLE public.activities ADD CONSTRAINT meal_root_only CHECK (kind <> 'meal' OR ("parentId" IS NULL AND "occurrenceId" IS NULL));
ALTER TABLE public.inventory_operations DROP CONSTRAINT inventory_adjustment_only;
ALTER TABLE public.inventory_operations ADD CONSTRAINT inventory_operation_shape CHECK (
  (kind='adjustment' AND "sourceActivityId" IS NULL AND "reversalOfId" IS NULL AND "sourceRevision" >= 0)
  OR (kind='mealCompletion' AND "sourceActivityId" IS NOT NULL AND "reversalOfId" IS NULL AND "sourceRevision" >= 0)
  OR (kind='reversal' AND "sourceActivityId" IS NOT NULL AND "reversalOfId" IS NOT NULL AND "sourceRevision" >= 0)
);
CREATE UNIQUE INDEX meal_one_active_completion ON public.meal_completions ("blockId") WHERE "reversedAt" IS NULL;
ALTER TABLE public.meal_completions ADD CONSTRAINT meal_optionals_shape CHECK (jsonb_typeof("optionalSteps")='array');
ALTER TABLE public.cooked_batches ADD CONSTRAINT cooked_positive CHECK (quantity > 0);
ALTER TABLE public.portion_uses ADD CONSTRAINT portion_use_positive CHECK (quantity > 0);

CREATE FUNCTION public.miagenda_consumption_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE permitted text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'consumption_evidence_retained' USING ERRCODE='23514'; END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId");
  IF TG_OP='UPDATE' THEN
    permitted := CASE WHEN TG_TABLE_NAME='cooked_batches' THEN 'revokedAt' ELSE 'reversedAt' END;
    IF (to_jsonb(NEW)-permitted) IS DISTINCT FROM (to_jsonb(OLD)-permitted)
      OR to_jsonb(OLD)->>permitted IS NOT NULL OR to_jsonb(NEW)->>permitted IS NULL THEN
      RAISE EXCEPTION 'consumption_identity_immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meal_completion_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.meal_completions FOR EACH ROW EXECUTE FUNCTION public.miagenda_consumption_write();
CREATE TRIGGER cooked_batch_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.cooked_batches FOR EACH ROW EXECUTE FUNCTION public.miagenda_consumption_write();
CREATE TRIGGER portion_use_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.portion_uses FOR EACH ROW EXECUTE FUNCTION public.miagenda_consumption_write();

CREATE FUNCTION public.miagenda_batch_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE key_id uuid; b public.cooked_batches%ROWTYPE; used numeric; c public.meal_completions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='cooked_batches' THEN key_id:=NEW.id; ELSE key_id:=NEW."batchId"; END IF;
  SELECT * INTO b FROM public.cooked_batches WHERE id=key_id AND "userId"=NEW."userId";
  SELECT * INTO c FROM public.meal_completions WHERE id=b."completionId" AND "userId"=b."userId";
  SELECT coalesce(sum(quantity),0) INTO used FROM public.portion_uses WHERE "batchId"=key_id AND "userId"=b."userId" AND "reversedAt" IS NULL;
  IF used > b.quantity OR (b."revokedAt" IS NOT NULL AND used<>0) OR (b."revokedAt" IS NULL) <> (c."reversedAt" IS NULL) THEN
    RAISE EXCEPTION 'batch_portions_invalid' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.portion_uses u JOIN public.meal_completions r ON r.id=u."completionId" AND r."userId"=u."userId" WHERE u."batchId"=b.id AND u."userId"=b."userId" AND (u."reversedAt" IS NULL) <> (r."reversedAt" IS NULL)) THEN
    RAISE EXCEPTION 'portion_reversal_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER batch_portions_final AFTER INSERT OR UPDATE ON public.cooked_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_batch_final();
CREATE CONSTRAINT TRIGGER portion_balance_final AFTER INSERT OR UPDATE ON public.portion_uses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_batch_final();

CREATE FUNCTION public.miagenda_completion_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE c public.meal_completions%ROWTYPE; a public.activities%ROWTYPE; o public.inventory_operations%ROWTYPE; reversed boolean;
BEGIN
  SELECT * INTO c FROM public.meal_completions WHERE id=NEW.id AND "userId"=NEW."userId";
  SELECT * INTO a FROM public.activities WHERE id=c."blockId" AND "userId"=c."userId";
  SELECT * INTO o FROM public.inventory_operations WHERE id=c."operationId" AND "userId"=c."userId";
  SELECT EXISTS(SELECT 1 FROM public.inventory_operations WHERE "reversalOfId"=o.id AND "userId"=c."userId") INTO reversed;
  IF a.kind <> 'meal' OR o.kind <> 'mealCompletion' OR o."sourceActivityId" <> a.id OR reversed <> (c."reversedAt" IS NOT NULL)
    OR (a.lifecycle='active' AND (a."completedAt" IS NOT NULL) <> EXISTS(SELECT 1 FROM public.meal_completions WHERE "blockId"=a.id AND "userId"=a."userId" AND "reversedAt" IS NULL)) THEN
    RAISE EXCEPTION 'meal_completion_state_invalid' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.cooked_batches WHERE "completionId"=c.id AND "userId"=c."userId" AND ("revokedAt" IS NULL) <> (c."reversedAt" IS NULL))
    OR EXISTS(SELECT 1 FROM public.portion_uses WHERE "completionId"=c.id AND "userId"=c."userId" AND ("reversedAt" IS NULL) <> (c."reversedAt" IS NULL)) THEN RAISE EXCEPTION 'meal_reversal_incomplete' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER meal_completion_final AFTER INSERT OR UPDATE ON public.meal_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_completion_final();

CREATE FUNCTION public.miagenda_inventory_effect_final() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.inventory_operations%ROWTYPE; original public.inventory_operations%ROWTYPE; op_id uuid;
BEGIN
  IF TG_TABLE_NAME='inventory_movements' THEN op_id:=NEW."operationId"; ELSE op_id:=NEW.id; END IF;
  SELECT * INTO o FROM public.inventory_operations WHERE id=op_id AND "userId"=NEW."userId";
  IF o.kind='mealCompletion' THEN
    IF NOT EXISTS(SELECT 1 FROM public.meal_completions WHERE "operationId"=o.id AND "userId"=o."userId") OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE "operationId"=o.id AND delta>=0) THEN RAISE EXCEPTION 'meal_inventory_effect_invalid' USING ERRCODE='23514'; END IF;
  ELSIF o.kind='reversal' THEN
    SELECT * INTO original FROM public.inventory_operations WHERE id=o."reversalOfId" AND "userId"=o."userId";
    IF original.kind <> 'mealCompletion' OR original."sourceActivityId" <> o."sourceActivityId" OR NOT EXISTS(SELECT 1 FROM public.meal_completions WHERE "operationId"=original.id AND "reversedAt" IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.inventory_movements old LEFT JOIN public.inventory_movements n ON n."ingredientId"=old."ingredientId" AND n."operationId"=o.id WHERE old."operationId"=original.id AND (n.delta IS DISTINCT FROM -old.delta OR n.unit IS DISTINCT FROM old.unit))
      OR (SELECT count(*) FROM public.inventory_movements WHERE "operationId"=o.id) <> (SELECT count(*) FROM public.inventory_movements WHERE "operationId"=original.id)
      THEN RAISE EXCEPTION 'inventory_reversal_not_exact' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER inventory_effect_final AFTER INSERT ON public.inventory_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_inventory_effect_final();
CREATE CONSTRAINT TRIGGER inventory_line_effect_final AFTER INSERT ON public.inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_inventory_effect_final();

CREATE OR REPLACE FUNCTION public.miagenda_meal_final() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE a public.activities%ROWTYPE; s public.activity_schedules%ROWTYPE; c public.meal_cells%ROWTYPE; key_id uuid; owner_id uuid;
BEGIN
  IF TG_TABLE_NAME='activities' THEN
    key_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME='meal_cells' THEN
    key_id := CASE WHEN TG_OP='DELETE' THEN OLD."blockId" ELSE NEW."blockId" END;
  ELSE key_id := CASE WHEN TG_OP='DELETE' THEN OLD."activityId" ELSE NEW."activityId" END;
  END IF;
  owner_id := CASE WHEN TG_OP='DELETE' THEN OLD."userId" ELSE NEW."userId" END;
  SELECT * INTO a FROM public.activities WHERE id=key_id AND "userId"=owner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF a.kind='meal' AND a.lifecycle='active' THEN
    SELECT * INTO s FROM public.activity_schedules WHERE "activityId"=a.id AND "userId"=owner_id;
    SELECT * INTO c FROM public.meal_cells WHERE "blockId"=a.id AND "userId"=owner_id;
    IF s."activityId" IS NULL OR s.mode <> 'timed' OR c."blockId" IS NULL OR c."planningDate" <> (s."startsAt" AT TIME ZONE s."timeZone")::date
      OR NOT EXISTS (SELECT 1 FROM public.calendars WHERE id=s."calendarId" AND "userId"=owner_id AND "moduleKey"='kitchen')
      OR NOT EXISTS (SELECT 1 FROM public.meal_slots WHERE id=c."slotId" AND "userId"=owner_id AND "retiredAt" IS NULL)
      OR NOT EXISTS (SELECT 1 FROM public.meal_recipes WHERE "blockId"=a.id AND "userId"=owner_id) THEN RAISE EXCEPTION 'meal_schedule_cell_required' USING ERRCODE='23514'; END IF;
  END IF;
  IF a.kind='meal' AND a.lifecycle='active' THEN
    IF (a."completedAt" IS NOT NULL) <> EXISTS(SELECT 1 FROM public.meal_completions WHERE "blockId"=a.id AND "userId"=owner_id AND "reversedAt" IS NULL) THEN RAISE EXCEPTION 'meal_effect_required' USING ERRCODE='23514'; END IF;
    IF a."completedAt" IS NOT NULL AND EXISTS(SELECT 1 FROM public.meal_step_data d JOIN public.activities step ON step.id=d."activityId" AND step."userId"=d."userId" JOIN public.meal_recipes r ON r.id=d."mealRecipeId" AND r."userId"=d."userId" WHERE r."blockId"=a.id AND r."userId"=owner_id AND d.role='preparation' AND NOT d.optional AND step.lifecycle='active' AND step."completedAt" IS NULL) THEN RAISE EXCEPTION 'meal_required_steps_pending' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;

COMMIT;
