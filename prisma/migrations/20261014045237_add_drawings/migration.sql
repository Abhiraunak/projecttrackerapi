-- CreateTable
CREATE TABLE "Drawing" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "publicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingShare" (
    "drawingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingShare_pkey" PRIMARY KEY ("drawingId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Drawing_publicId_key" ON "Drawing"("publicId");

-- CreateIndex
CREATE INDEX "Drawing_ownerId_createdAt_idx" ON "Drawing"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DrawingShare_userId_createdAt_idx" ON "DrawingShare"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingShare" ADD CONSTRAINT "DrawingShare_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingShare" ADD CONSTRAINT "DrawingShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
