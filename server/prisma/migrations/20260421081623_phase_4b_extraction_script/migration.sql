-- AlterTable
ALTER TABLE "DxfFile" ADD COLUMN     "complianceData" JSONB;

-- CreateTable
CREATE TABLE "ExtractionScript" (
    "id" TEXT NOT NULL,
    "structuralHash" TEXT NOT NULL,
    "storedFileId" TEXT NOT NULL,
    "generatedByModel" TEXT NOT NULL,
    "generationCostUsd" DECIMAL(10,4) NOT NULL,
    "generationMs" INTEGER NOT NULL,
    "fixedFromScriptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionScript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionScript_storedFileId_key" ON "ExtractionScript"("storedFileId");

-- CreateIndex
CREATE INDEX "ExtractionScript_structuralHash_createdAt_idx" ON "ExtractionScript"("structuralHash", "createdAt");

-- AddForeignKey
ALTER TABLE "ExtractionScript" ADD CONSTRAINT "ExtractionScript_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 4b data migration: null old explorationJson on any row whose shape
-- predates v3.1 (v4b explorer emits text_samples[].raw; v3.0/4a emitted strings
-- or lacked the key entirely). Also nulls any still-running non-COMPLETED row
-- so the next handler invocation re-explores. Byte-dedup on re-upload would
-- otherwise feed v3.0-shaped JSON into the v3.1 codegen prompt and crash.
UPDATE "DxfFile"
SET "explorationJson" = NULL,
    "structuralHash" = NULL
WHERE "explorationJson" IS NOT NULL
  AND (
    "extractionStatus" <> 'COMPLETED'
    OR NOT ("explorationJson" #> '{blocks,0,text_samples,0}' ? 'raw')
  );
