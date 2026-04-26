-- CreateEnum
CREATE TYPE "SheetClassification" AS ENUM ('INDEX_PAGE', 'FLOOR_PLAN', 'CROSS_SECTION', 'ELEVATION', 'PARKING_SECTION', 'SURVEY', 'SITE_PLAN', 'ROOF_PLAN', 'AREA_CALCULATION', 'UNCLASSIFIED');

-- CreateTable
CREATE TABLE "SheetRender" (
    "id" TEXT NOT NULL,
    "dxfFileId" TEXT NOT NULL,
    "storedFileId" TEXT NOT NULL,
    "sheetIndex" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "classification" "SheetClassification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "geometryBlock" TEXT,
    "annotationBlock" TEXT,
    "svgWarning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetRender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SheetRender_storedFileId_key" ON "SheetRender"("storedFileId");

-- CreateIndex
CREATE INDEX "SheetRender_dxfFileId_classification_idx" ON "SheetRender"("dxfFileId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "SheetRender_dxfFileId_sheetIndex_key" ON "SheetRender"("dxfFileId", "sheetIndex");

-- AddForeignKey
ALTER TABLE "SheetRender" ADD CONSTRAINT "SheetRender_dxfFileId_fkey" FOREIGN KEY ("dxfFileId") REFERENCES "DxfFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRender" ADD CONSTRAINT "SheetRender_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
