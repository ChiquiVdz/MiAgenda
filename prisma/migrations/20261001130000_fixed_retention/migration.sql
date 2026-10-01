-- Retention is a fixed application rule now; there is no per-user preference.
ALTER TABLE "users" DROP COLUMN "retention_days";
