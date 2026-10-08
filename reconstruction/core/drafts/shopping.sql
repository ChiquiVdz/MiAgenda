-- CreateTable
CREATE TABLE "shopping_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ingredientId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "free" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL(12,3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopping_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_receipts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "requiredQuantity" DECIMAL(12,3) NOT NULL,
    "optionalQuantity" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),

    CONSTRAINT "shopping_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shopping_entries_userId_retiredAt_closedAt_idx" ON "shopping_entries"("userId", "retiredAt", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_entries_id_userId_key" ON "shopping_entries"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_receipts_operationId_key" ON "shopping_receipts"("operationId");

-- CreateIndex
CREATE INDEX "shopping_receipts_userId_createdAt_id_idx" ON "shopping_receipts"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_receipts_id_userId_key" ON "shopping_receipts"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_receipts_operationId_userId_key" ON "shopping_receipts"("operationId", "userId");

-- AddForeignKey
ALTER TABLE "shopping_entries" ADD CONSTRAINT "shopping_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shopping_entries" ADD CONSTRAINT "shopping_entries_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shopping_receipts" ADD CONSTRAINT "shopping_receipts_entryId_userId_fkey" FOREIGN KEY ("entryId", "userId") REFERENCES "shopping_entries"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shopping_receipts" ADD CONSTRAINT "shopping_receipts_operationId_userId_fkey" FOREIGN KEY ("operationId", "userId") REFERENCES "inventory_operations"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;
