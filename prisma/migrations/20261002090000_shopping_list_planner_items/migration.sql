ALTER TABLE "shopping_lists"
    ADD COLUMN "range_start" TIMESTAMP(3),
    ADD COLUMN "range_end" TIMESTAMP(3);

ALTER TABLE "shopping_list_items"
    ADD COLUMN "item_key" VARCHAR(140),
    ADD COLUMN "custom_unit" VARCHAR(20);

UPDATE "shopping_list_items"
SET "item_key" = 'ingredient:' || "ingredient_id";

ALTER TABLE "shopping_list_items"
    ALTER COLUMN "item_key" SET NOT NULL,
    ALTER COLUMN "ingredient_id" DROP NOT NULL,
    ALTER COLUMN "unit" DROP NOT NULL;

CREATE UNIQUE INDEX "shopping_list_items_shopping_list_id_item_key_key"
    ON "shopping_list_items"("shopping_list_id", "item_key");
CREATE INDEX "shopping_lists_user_id_range_start_range_end_idx"
    ON "shopping_lists"("user_id", "range_start", "range_end");
