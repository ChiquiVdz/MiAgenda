ALTER TABLE "users" ADD COLUMN "meal_slots_initialized" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "meal_slots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "default_time" VARCHAR(5) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meal_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meal_slots_user_id_position_idx" ON "meal_slots"("user_id", "position");

ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meal_plans" ADD COLUMN "meal_slot_id" TEXT;
CREATE INDEX "meal_plans_meal_slot_id_idx" ON "meal_plans"("meal_slot_id");
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_meal_slot_id_fkey"
    FOREIGN KEY ("meal_slot_id") REFERENCES "meal_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
