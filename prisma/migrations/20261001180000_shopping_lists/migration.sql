CREATE TABLE "shopping_lists" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recipe_id" TEXT,
    "recipe_name_snapshot" VARCHAR(150) NOT NULL,
    "servings" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopping_list_items" (
    "id" TEXT NOT NULL,
    "shopping_list_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "name_snapshot" VARCHAR(100) NOT NULL,
    "unit" "ingredient_unit" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "purchased_quantity" DECIMAL(12,3),
    "purchased_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shopping_list_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopping_lists_user_id_idempotency_key_key"
    ON "shopping_lists"("user_id", "idempotency_key");
CREATE INDEX "shopping_lists_user_id_created_at_idx" ON "shopping_lists"("user_id", "created_at");

CREATE UNIQUE INDEX "shopping_list_items_shopping_list_id_ingredient_id_key"
    ON "shopping_list_items"("shopping_list_id", "ingredient_id");
CREATE INDEX "shopping_list_items_ingredient_id_idx" ON "shopping_list_items"("ingredient_id");

ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_shopping_list_id_fkey"
    FOREIGN KEY ("shopping_list_id") REFERENCES "shopping_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
