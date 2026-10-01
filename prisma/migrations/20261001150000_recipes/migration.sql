-- Recipe quantities reference the same canonical ingredient IDs as the pantry.
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "instructions" TEXT NOT NULL,
    "servings" INTEGER NOT NULL DEFAULT 2,
    "duration_minutes" INTEGER NOT NULL DEFAULT 45,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity_per_serving" DECIMAL(12,3) NOT NULL,
    "equivalent" VARCHAR(120),
    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recipes_user_id_name_idx" ON "recipes"("user_id", "name");
CREATE UNIQUE INDEX "recipe_ingredients_recipe_id_ingredient_id_key" ON "recipe_ingredients"("recipe_id", "ingredient_id");
CREATE INDEX "recipe_ingredients_ingredient_id_idx" ON "recipe_ingredients"("ingredient_id");

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
