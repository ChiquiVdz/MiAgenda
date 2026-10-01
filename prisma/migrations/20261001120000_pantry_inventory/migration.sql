-- Add the first Cocina inventory tables. Existing Agenda data is unchanged.
CREATE TYPE "ingredient_unit" AS ENUM ('g', 'kg', 'ml', 'l', 'piece');

CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "unit" "ingredient_unit" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pantry_items" (
    "id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "equivalent" VARCHAR(100),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pantry_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ingredients_user_id_normalized_name_key" ON "ingredients"("user_id", "normalized_name");
CREATE INDEX "ingredients_user_id_idx" ON "ingredients"("user_id");
CREATE UNIQUE INDEX "pantry_items_ingredient_id_key" ON "pantry_items"("ingredient_id");

ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
