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
ALTER TABLE public.recipes ADD CONSTRAINT recipe_revision_valid CHECK (revision >= 0);
ALTER TABLE public.recipe_revisions ADD CONSTRAINT recipe_content_valid CHECK (version > 0 AND length(trim(name)) > 0 AND ("baseServings" IS NULL OR "baseServings" > 0) AND ("cookingMinutes" IS NULL OR "cookingMinutes" BETWEEN 1 AND 10080) AND (draft OR ("baseServings" IS NOT NULL AND "cookingMinutes" IS NOT NULL)));
ALTER TABLE public.recipe_steps ADD CONSTRAINT recipe_step_valid CHECK (position >= 0 AND length(trim(text)) > 0 AND (("ingredientId" IS NULL AND "ingredientNameSnapshot" IS NULL AND "unitSnapshot" IS NULL AND "quantityForBaseServings" IS NULL AND equivalent IS NULL) OR ("ingredientId" IS NOT NULL AND "ingredientNameSnapshot" IS NOT NULL AND "unitSnapshot" IS NOT NULL AND "quantityForBaseServings" IS NOT NULL AND "quantityForBaseServings" > 0)) AND (("minutesBefore" IS NULL AND "priorTitle" IS NULL) OR ("minutesBefore" IS NOT NULL AND "priorTitle" IS NOT NULL AND "minutesBefore" BETWEEN 1 AND 525600 AND length(trim("priorTitle")) > 0)));
CREATE FUNCTION public.miagenda_recipe_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'recipe_evidence_immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME = 'recipes' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.id <> OLD.id OR NEW."userId" <> OLD."userId" THEN RAISE EXCEPTION 'recipe_identity_fixed' USING ERRCODE='23514'; END IF;
      NEW.revision := OLD.revision + 1;
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'recipe_version_immutable' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME = 'recipe_steps' THEN
      IF NEW."ingredientId" IS NOT NULL AND (NOT public.miagenda_ingredient_access(NEW."userId", NEW."ingredientId") OR NOT EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id=NEW."ingredientId" AND i.unit=NEW."unitSnapshot" AND i.name=NEW."ingredientNameSnapshot")) THEN RAISE EXCEPTION 'recipe_ingredient_access' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  PERFORM public.miagenda_touch_owner(NEW."userId");
  RETURN NEW;
END $$;
CREATE TRIGGER recipe_identity_revision BEFORE INSERT OR UPDATE OR DELETE ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.miagenda_recipe_write();
CREATE TRIGGER recipe_version_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.recipe_revisions FOR EACH ROW EXECUTE FUNCTION public.miagenda_recipe_write();
CREATE TRIGGER recipe_step_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.recipe_steps FOR EACH ROW EXECUTE FUNCTION public.miagenda_recipe_write();
CREATE FUNCTION public.miagenda_recipe_ready() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.draft AND NOT EXISTS (SELECT 1 FROM public.recipe_steps WHERE "recipeRevisionId"=NEW.id) THEN RAISE EXCEPTION 'ready_recipe_requires_step' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER recipe_ready_check AFTER INSERT ON public.recipe_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.miagenda_recipe_ready();
