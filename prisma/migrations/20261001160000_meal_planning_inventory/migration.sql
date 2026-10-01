CREATE TABLE "meal_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recipe_id" TEXT,
    "overlay_id" TEXT NOT NULL,
    "google_calendar_id" TEXT NOT NULL,
    "google_event_id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "servings" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meal_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meal_plan_ingredients" (
    "id" TEXT NOT NULL,
    "meal_plan_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "name_snapshot" VARCHAR(100) NOT NULL,
    "unit" "ingredient_unit" NOT NULL,
    "required_quantity" DECIMAL(12,3) NOT NULL,
    CONSTRAINT "meal_plan_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_ledger" (
    "id" TEXT NOT NULL,
    "meal_plan_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "delta" DECIMAL(12,3) NOT NULL,
    "unit" "ingredient_unit" NOT NULL,
    "reversal_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meal_plans_overlay_id_key" ON "meal_plans"("overlay_id");
CREATE UNIQUE INDEX "meal_plans_user_id_google_calendar_id_google_event_id_key"
    ON "meal_plans"("user_id", "google_calendar_id", "google_event_id");
CREATE UNIQUE INDEX "meal_plans_user_id_idempotency_key_key"
    ON "meal_plans"("user_id", "idempotency_key");
CREATE INDEX "meal_plans_user_id_completed_at_idx" ON "meal_plans"("user_id", "completed_at");

CREATE UNIQUE INDEX "meal_plan_ingredients_meal_plan_id_ingredient_id_key"
    ON "meal_plan_ingredients"("meal_plan_id", "ingredient_id");
CREATE INDEX "meal_plan_ingredients_ingredient_id_idx" ON "meal_plan_ingredients"("ingredient_id");

CREATE UNIQUE INDEX "inventory_ledger_reversal_of_id_key" ON "inventory_ledger"("reversal_of_id");
CREATE INDEX "inventory_ledger_meal_plan_id_created_at_idx" ON "inventory_ledger"("meal_plan_id", "created_at");

ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_overlay_id_fkey"
    FOREIGN KEY ("overlay_id") REFERENCES "event_overlays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meal_plan_ingredients" ADD CONSTRAINT "meal_plan_ingredients_meal_plan_id_fkey"
    FOREIGN KEY ("meal_plan_id") REFERENCES "meal_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meal_plan_ingredients" ADD CONSTRAINT "meal_plan_ingredients_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_meal_plan_id_fkey"
    FOREIGN KEY ("meal_plan_id") REFERENCES "meal_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_reversal_of_id_fkey"
    FOREIGN KEY ("reversal_of_id") REFERENCES "inventory_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Remove only unused private spelling variants; keep any entry with existing
-- pantry or recipe references so no user's data is orphaned.
DELETE FROM "ingredients" AS ingredient
WHERE ingredient."owner_user_id" IS NOT NULL
  AND ingredient."normalized_name" IN ('arros', 'arrox')
  AND NOT EXISTS (
    SELECT 1 FROM "pantry_items" pantry
    WHERE pantry."ingredient_id" = ingredient."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "recipe_ingredients" recipe_ingredient
    WHERE recipe_ingredient."ingredient_id" = ingredient."id"
  );
