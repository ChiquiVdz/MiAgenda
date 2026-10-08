-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_revisions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "description" TEXT,
    "draft" BOOLEAN NOT NULL DEFAULT true,
    "baseServings" DECIMAL(10,3),
    "cookingMinutes" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_steps" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recipeRevisionId" UUID NOT NULL,
    "stepKey" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "ingredientId" UUID,
    "ingredientNameSnapshot" VARCHAR(120),
    "unitSnapshot" "IngredientUnit",
    "quantityForBaseServings" DECIMAL(12,3),
    "equivalent" VARCHAR(120),
    "minutesBefore" INTEGER,
    "priorTitle" VARCHAR(150),

    CONSTRAINT "recipe_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipes_userId_retiredAt_id_idx" ON "recipes"("userId", "retiredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_id_userId_key" ON "recipes"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_revisions_id_userId_key" ON "recipe_revisions"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_revisions_recipeId_version_key" ON "recipe_revisions"("recipeId", "version");

-- CreateIndex
CREATE INDEX "recipe_steps_ingredientId_idx" ON "recipe_steps"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_steps_recipeRevisionId_stepKey_key" ON "recipe_steps"("recipeRevisionId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_steps_recipeRevisionId_position_key" ON "recipe_steps"("recipeRevisionId", "position");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recipe_revisions" ADD CONSTRAINT "recipe_revisions_recipeId_userId_fkey" FOREIGN KEY ("recipeId", "userId") REFERENCES "recipes"("id", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipeRevisionId_userId_fkey" FOREIGN KEY ("recipeRevisionId", "userId") REFERENCES "recipe_revisions"("id", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
