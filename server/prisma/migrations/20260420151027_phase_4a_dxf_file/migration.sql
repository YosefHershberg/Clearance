-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'EXTRACTING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "DxfFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storedFileId" TEXT NOT NULL,
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractionError" TEXT,
    "extractionJobId" TEXT,
    "explorationJson" JSONB,
    "structuralHash" TEXT,
    "extractionTrace" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DxfFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DxfFile_storedFileId_key" ON "DxfFile"("storedFileId");

-- CreateIndex
CREATE INDEX "DxfFile_projectId_createdAt_idx" ON "DxfFile"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "DxfFile_structuralHash_idx" ON "DxfFile"("structuralHash");

-- AddForeignKey
ALTER TABLE "DxfFile" ADD CONSTRAINT "DxfFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DxfFile" ADD CONSTRAINT "DxfFile_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
