-- CreateTable
CREATE TABLE "meal_completions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "optionalSteps" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),

    CONSTRAINT "meal_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cooked_batches" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completionId" UUID NOT NULL,
    "recipeRevisionId" UUID NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "cooked_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portion_uses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completionId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),

    CONSTRAINT "portion_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_completions_operationId_key" ON "meal_completions"("operationId");

-- CreateIndex
CREATE INDEX "meal_completions_userId_blockId_createdAt_idx" ON "meal_completions"("userId", "blockId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "meal_completions_id_userId_key" ON "meal_completions"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_completions_operationId_userId_key" ON "meal_completions"("operationId", "userId");

-- CreateIndex
CREATE INDEX "cooked_batches_userId_revokedAt_createdAt_idx" ON "cooked_batches"("userId", "revokedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cooked_batches_id_userId_key" ON "cooked_batches"("id", "userId");

-- CreateIndex
CREATE INDEX "portion_uses_userId_batchId_reversedAt_idx" ON "portion_uses"("userId", "batchId", "reversedAt");

-- CreateIndex
CREATE UNIQUE INDEX "portion_uses_completionId_batchId_key" ON "portion_uses"("completionId", "batchId");

-- AddForeignKey
ALTER TABLE "meal_completions" ADD CONSTRAINT "meal_completions_blockId_userId_fkey" FOREIGN KEY ("blockId", "userId") REFERENCES "meal_blocks"("activityId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_completions" ADD CONSTRAINT "meal_completions_operationId_userId_fkey" FOREIGN KEY ("operationId", "userId") REFERENCES "inventory_operations"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cooked_batches" ADD CONSTRAINT "cooked_batches_completionId_userId_fkey" FOREIGN KEY ("completionId", "userId") REFERENCES "meal_completions"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cooked_batches" ADD CONSTRAINT "cooked_batches_recipeRevisionId_userId_fkey" FOREIGN KEY ("recipeRevisionId", "userId") REFERENCES "recipe_revisions"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "portion_uses" ADD CONSTRAINT "portion_uses_completionId_userId_fkey" FOREIGN KEY ("completionId", "userId") REFERENCES "meal_completions"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "portion_uses" ADD CONSTRAINT "portion_uses_batchId_userId_fkey" FOREIGN KEY ("batchId", "userId") REFERENCES "cooked_batches"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;
