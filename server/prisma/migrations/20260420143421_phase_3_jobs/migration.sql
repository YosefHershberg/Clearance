-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DXF_EXTRACTION', 'TAVA_EXTRACTION', 'ADDON_EXTRACTION', 'CORE_ANALYSIS', 'ADDON_RUN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "projectId" TEXT,
    "analysisId" TEXT,
    "addonRunId" TEXT,
    "dxfFileId" TEXT,
    "tavaFileId" TEXT,
    "addonDocumentId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");
