-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('SORIANA', 'CHEDRAUI', 'HEB', 'AL_SUPER', 'LA_COMER', 'AMAZON');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('MIXED', 'VENTAS', 'INVENTARIO');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "nameStandard" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "portalString" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalCredential" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "username" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hasPasswordPending" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "fileType" "FileType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsUnmapped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelloutData" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodDate" TIMESTAMP(3),
    "chain" "Chain" NOT NULL,
    "productId" TEXT,
    "portalRawProduct" TEXT NOT NULL,
    "storeId" TEXT,
    "storeName" TEXT,
    "storeFormat" TEXT,
    "salesUnits" INTEGER,
    "salesUnitsEstimated" BOOLEAN NOT NULL DEFAULT false,
    "salesAmountMxn" DECIMAL(12,2),
    "purchasesUnits" INTEGER,
    "purchasesAmountMxn" DECIMAL(12,2),
    "inventoryUnits" INTEGER,
    "inventoryAmountCostMxn" DECIMAL(12,2),
    "inventoryAmountPriceMxn" DECIMAL(12,2),
    "daysOfInventory" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelloutData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnmappedProduct" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "portalString" TEXT NOT NULL,
    "firstSeenUploadId" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),
    "resolvedProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmappedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Client_userId_idx" ON "Client"("userId");

-- CreateIndex
CREATE INDEX "Product_clientId_idx" ON "Product"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_clientId_nameStandard_key" ON "Product"("clientId", "nameStandard");

-- CreateIndex
CREATE INDEX "ProductMapping_clientId_chain_idx" ON "ProductMapping"("clientId", "chain");

-- CreateIndex
CREATE INDEX "ProductMapping_productId_idx" ON "ProductMapping"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_clientId_chain_portalString_key" ON "ProductMapping"("clientId", "chain", "portalString");

-- CreateIndex
CREATE UNIQUE INDEX "PortalCredential_clientId_chain_key" ON "PortalCredential"("clientId", "chain");

-- CreateIndex
CREATE INDEX "Upload_clientId_chain_fileType_idx" ON "Upload"("clientId", "chain", "fileType");

-- CreateIndex
CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");

-- CreateIndex
CREATE INDEX "Upload_uploadedAt_idx" ON "Upload"("uploadedAt");

-- CreateIndex
CREATE INDEX "SelloutData_clientId_chain_idx" ON "SelloutData"("clientId", "chain");

-- CreateIndex
CREATE INDEX "SelloutData_clientId_productId_idx" ON "SelloutData"("clientId", "productId");

-- CreateIndex
CREATE INDEX "SelloutData_clientId_periodYear_periodMonth_idx" ON "SelloutData"("clientId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "SelloutData_userId_idx" ON "SelloutData"("userId");

-- CreateIndex
CREATE INDEX "SelloutData_uploadId_idx" ON "SelloutData"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "sellout_unique_idx" ON "SelloutData"("clientId", "chain", "storeId", "portalRawProduct", "periodYear", "periodMonth") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "UnmappedProduct_clientId_chain_resolvedAt_idx" ON "UnmappedProduct"("clientId", "chain", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnmappedProduct_clientId_chain_portalString_key" ON "UnmappedProduct"("clientId", "chain", "portalString");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalCredential" ADD CONSTRAINT "PortalCredential_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelloutData" ADD CONSTRAINT "SelloutData_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelloutData" ADD CONSTRAINT "SelloutData_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelloutData" ADD CONSTRAINT "SelloutData_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmappedProduct" ADD CONSTRAINT "UnmappedProduct_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmappedProduct" ADD CONSTRAINT "UnmappedProduct_firstSeenUploadId_fkey" FOREIGN KEY ("firstSeenUploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
