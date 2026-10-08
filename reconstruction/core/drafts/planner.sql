-- CreateEnum
CREATE TYPE "MealStepRole" AS ENUM ('preparation', 'priorReminder');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kitchenInitialized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "meal_slots" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "meal_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_blocks" (
    "activityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eatingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "washingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eatingMinutes" INTEGER NOT NULL,
    "washingMinutes" INTEGER NOT NULL,
    "cookingMinutesOverride" INTEGER,
    "durationMinutesOverride" INTEGER,

    CONSTRAINT "meal_blocks_pkey" PRIMARY KEY ("activityId")
);

-- CreateTable
CREATE TABLE "meal_cells" (
    "blockId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "planningDate" DATE NOT NULL,

    CONSTRAINT "meal_cells_pkey" PRIMARY KEY ("blockId")
);

-- CreateTable
CREATE TABLE "meal_recipes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "recipeRevisionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "cookedServings" DECIMAL(10,3) NOT NULL,
    "eatenServings" DECIMAL(10,3) NOT NULL,
    "cookingMinutesOverride" INTEGER,

    CONSTRAINT "meal_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_step_data" (
    "activityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mealRecipeId" UUID NOT NULL,
    "sourceStepKey" UUID NOT NULL,
    "role" "MealStepRole" NOT NULL,
    "ingredientId" UUID,
    "ingredientNameSnapshot" VARCHAR(120),
    "unitSnapshot" "IngredientUnit",
    "quantityPerServing" DECIMAL(18,9),
    "equivalent" VARCHAR(120),
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "suggestedMinutesBefore" INTEGER,
    "scheduleManuallyAdjusted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "meal_step_data_pkey" PRIMARY KEY ("activityId")
);

-- CreateIndex
CREATE INDEX "meal_slots_userId_retiredAt_position_idx" ON "meal_slots"("userId", "retiredAt", "position");

-- CreateIndex
CREATE UNIQUE INDEX "meal_slots_id_userId_key" ON "meal_slots"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_blocks_activityId_userId_key" ON "meal_blocks"("activityId", "userId");

-- CreateIndex
CREATE INDEX "meal_cells_userId_planningDate_idx" ON "meal_cells"("userId", "planningDate");

-- CreateIndex
CREATE UNIQUE INDEX "meal_cells_blockId_userId_key" ON "meal_cells"("blockId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_cells_slotId_planningDate_key" ON "meal_cells"("slotId", "planningDate");

-- CreateIndex
CREATE INDEX "meal_recipes_blockId_position_idx" ON "meal_recipes"("blockId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "meal_recipes_id_userId_key" ON "meal_recipes"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_step_data_activityId_userId_key" ON "meal_step_data"("activityId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_step_data_mealRecipeId_sourceStepKey_role_key" ON "meal_step_data"("mealRecipeId", "sourceStepKey", "role");

-- AddForeignKey
ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_blocks" ADD CONSTRAINT "meal_blocks_activityId_userId_fkey" FOREIGN KEY ("activityId", "userId") REFERENCES "activities"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_cells" ADD CONSTRAINT "meal_cells_blockId_userId_fkey" FOREIGN KEY ("blockId", "userId") REFERENCES "meal_blocks"("activityId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_cells" ADD CONSTRAINT "meal_cells_slotId_userId_fkey" FOREIGN KEY ("slotId", "userId") REFERENCES "meal_slots"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_recipes" ADD CONSTRAINT "meal_recipes_blockId_userId_fkey" FOREIGN KEY ("blockId", "userId") REFERENCES "meal_blocks"("activityId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_recipes" ADD CONSTRAINT "meal_recipes_recipeRevisionId_userId_fkey" FOREIGN KEY ("recipeRevisionId", "userId") REFERENCES "recipe_revisions"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_step_data" ADD CONSTRAINT "meal_step_data_activityId_userId_fkey" FOREIGN KEY ("activityId", "userId") REFERENCES "activities"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_step_data" ADD CONSTRAINT "meal_step_data_mealRecipeId_userId_fkey" FOREIGN KEY ("mealRecipeId", "userId") REFERENCES "meal_recipes"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_step_data" ADD CONSTRAINT "meal_step_data_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
