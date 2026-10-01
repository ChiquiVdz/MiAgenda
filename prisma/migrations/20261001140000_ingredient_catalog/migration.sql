-- Make ingredient definitions selectable and share their IDs between the
-- user's pantry and future recipe ingredients. Pantry quantities stay private.
ALTER TABLE "ingredients" ADD COLUMN "owner_user_id" TEXT;
ALTER TABLE "ingredients" ADD COLUMN "catalog_scope" VARCHAR(30) NOT NULL DEFAULT 'global';
ALTER TABLE "ingredients" ADD COLUMN "is_builtin" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX "ingredients_user_id_normalized_name_key";
DROP INDEX "ingredients_user_id_idx";

UPDATE "ingredients"
SET "owner_user_id" = "user_id",
    "catalog_scope" = "user_id",
    "normalized_name" = regexp_replace(
      translate(lower("name"), 'áéíóúüñ', 'aeiouun'),
      '[[:space:]]+', ' ', 'g'
    );

ALTER TABLE "pantry_items" ADD COLUMN "user_id" TEXT;
UPDATE "pantry_items" AS pantry
SET "user_id" = ingredient."owner_user_id"
FROM "ingredients" AS ingredient
WHERE ingredient."id" = pantry."ingredient_id";
ALTER TABLE "pantry_items" ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "ingredients" DROP CONSTRAINT "ingredients_user_id_fkey";
ALTER TABLE "ingredients" DROP COLUMN "user_id";

DROP INDEX "pantry_items_ingredient_id_key";
ALTER TABLE "pantry_items" DROP COLUMN "equivalent";

ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ingredients" ("id", "catalog_scope", "name", "normalized_name", "unit", "is_builtin", "created_at", "updated_at") VALUES
  ('builtin-rice', 'global', 'Arroz', 'arroz', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-milk', 'global', 'Leche', 'leche', 'ml', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-sugar', 'global', 'Azúcar', 'azucar', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-salt', 'global', 'Sal', 'sal', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-wheat-flour', 'global', 'Harina de trigo', 'harina de trigo', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-pasta', 'global', 'Pasta', 'pasta', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-beans', 'global', 'Frijol', 'frijol', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-lentils', 'global', 'Lenteja', 'lenteja', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-oats', 'global', 'Avena', 'avena', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-oil', 'global', 'Aceite', 'aceite', 'ml', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-butter', 'global', 'Mantequilla', 'mantequilla', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-egg', 'global', 'Huevo', 'huevo', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-chicken', 'global', 'Pollo', 'pollo', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-beef', 'global', 'Carne de res', 'carne de res', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-ground-beef', 'global', 'Carne molida', 'carne molida', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-tuna', 'global', 'Atún', 'atun', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-cheese', 'global', 'Queso', 'queso', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-tomato', 'global', 'Jitomate', 'jitomate', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-onion', 'global', 'Cebolla', 'cebolla', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-garlic', 'global', 'Ajo', 'ajo', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-potato', 'global', 'Papa', 'papa', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-carrot', 'global', 'Zanahoria', 'zanahoria', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-lemon', 'global', 'Limón', 'limon', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-serrano-chile', 'global', 'Chile serrano', 'chile serrano', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-jalapeno', 'global', 'Chile jalapeño', 'chile jalapeno', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-cilantro', 'global', 'Cilantro', 'cilantro', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-lettuce', 'global', 'Lechuga', 'lechuga', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-tortilla', 'global', 'Tortilla', 'tortilla', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-bread', 'global', 'Pan', 'pan', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-yogurt', 'global', 'Yogur', 'yogur', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-cream', 'global', 'Crema', 'crema', 'ml', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-bell-pepper', 'global', 'Pimiento', 'pimiento', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-cucumber', 'global', 'Pepino', 'pepino', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-spinach', 'global', 'Espinaca', 'espinaca', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-mushroom', 'global', 'Champiñón', 'champinon', 'g', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-avocado', 'global', 'Aguacate', 'aguacate', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-apple', 'global', 'Manzana', 'manzana', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-banana', 'global', 'Plátano', 'platano', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-orange', 'global', 'Naranja', 'naranja', 'piece', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-water', 'global', 'Agua', 'agua', 'ml', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-vinegar', 'global', 'Vinagre', 'vinagre', 'ml', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Merge existing per-user pantry entries into the matching shared definition,
-- converting kg→g and l→ml while preserving each user's own stock amount.
UPDATE "pantry_items" AS pantry
SET "quantity" = CASE
      WHEN old_ingredient."unit" = 'kg' AND shared."unit" = 'g' THEN pantry."quantity" * 1000
      WHEN old_ingredient."unit" = 'l' AND shared."unit" = 'ml' THEN pantry."quantity" * 1000
      ELSE pantry."quantity"
    END,
    "ingredient_id" = shared."id"
FROM "ingredients" AS old_ingredient
JOIN "ingredients" AS shared
  ON shared."catalog_scope" = 'global'
 AND shared."normalized_name" = old_ingredient."normalized_name"
WHERE pantry."ingredient_id" = old_ingredient."id"
  AND old_ingredient."owner_user_id" IS NOT NULL;

-- Normalize private custom entries too. If older spellings collapse to the
-- same key (for example with/without accents), keep one identity per user.
WITH ranked AS (
  SELECT "id", "catalog_scope",
         first_value("id") OVER (PARTITION BY "catalog_scope", "normalized_name" ORDER BY "created_at", "id") AS "keeper_id",
         first_value("unit") OVER (PARTITION BY "catalog_scope", "normalized_name" ORDER BY "created_at", "id") AS "keeper_unit",
         "unit"
  FROM "ingredients"
  WHERE "owner_user_id" IS NOT NULL
), duplicates AS (
  SELECT "id", "keeper_id", "unit", "keeper_unit" FROM ranked WHERE "id" <> "keeper_id"
)
UPDATE "pantry_items" AS pantry
SET "quantity" = CASE
      WHEN duplicate."unit" = 'kg' AND duplicate."keeper_unit" = 'g' THEN pantry."quantity" * 1000
      WHEN duplicate."unit" = 'g' AND duplicate."keeper_unit" = 'kg' THEN pantry."quantity" / 1000
      WHEN duplicate."unit" = 'l' AND duplicate."keeper_unit" = 'ml' THEN pantry."quantity" * 1000
      WHEN duplicate."unit" = 'ml' AND duplicate."keeper_unit" = 'l' THEN pantry."quantity" / 1000
      ELSE pantry."quantity"
    END,
    "ingredient_id" = duplicate."keeper_id"
FROM duplicates AS duplicate
WHERE pantry."ingredient_id" = duplicate."id";

WITH totals AS (
  SELECT "user_id", "ingredient_id", min("id") AS "keep_id", sum("quantity") AS "quantity"
  FROM "pantry_items"
  GROUP BY "user_id", "ingredient_id"
  HAVING count(*) > 1
)
UPDATE "pantry_items" AS pantry
SET "quantity" = totals."quantity"
FROM totals
WHERE pantry."id" = totals."keep_id";
DELETE FROM "pantry_items" AS pantry
USING (
  SELECT "user_id", "ingredient_id", min("id") AS "keep_id"
  FROM "pantry_items"
  GROUP BY "user_id", "ingredient_id"
  HAVING count(*) > 1
) AS duplicates
WHERE pantry."user_id" = duplicates."user_id"
  AND pantry."ingredient_id" = duplicates."ingredient_id"
  AND pantry."id" <> duplicates."keep_id";

DELETE FROM "ingredients" AS old_ingredient
USING "ingredients" AS shared
WHERE shared."catalog_scope" = 'global'
  AND shared."normalized_name" = old_ingredient."normalized_name"
  AND old_ingredient."owner_user_id" IS NOT NULL;

-- Keep canonical global units and names, not whichever case was first entered.
UPDATE "ingredients" SET "owner_user_id" = NULL, "is_builtin" = true
WHERE "catalog_scope" = 'global';

WITH ranked AS (
  SELECT "id",
         first_value("id") OVER (PARTITION BY "catalog_scope", "normalized_name" ORDER BY "created_at", "id") AS "keeper_id"
  FROM "ingredients"
)
DELETE FROM "ingredients" AS ingredient
USING ranked
WHERE ingredient."id" = ranked."id" AND ranked."id" <> ranked."keeper_id";

CREATE UNIQUE INDEX "ingredients_catalog_scope_normalized_name_key"
  ON "ingredients"("catalog_scope", "normalized_name");
CREATE INDEX "ingredients_owner_user_id_name_idx" ON "ingredients"("owner_user_id", "name");
CREATE UNIQUE INDEX "pantry_items_user_id_ingredient_id_key" ON "pantry_items"("user_id", "ingredient_id");
CREATE INDEX "pantry_items_user_id_idx" ON "pantry_items"("user_id");
