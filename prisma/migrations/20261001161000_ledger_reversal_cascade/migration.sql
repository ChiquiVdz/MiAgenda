ALTER TABLE "inventory_ledger" DROP CONSTRAINT "inventory_ledger_reversal_of_id_fkey";
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_reversal_of_id_fkey"
    FOREIGN KEY ("reversal_of_id") REFERENCES "inventory_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
