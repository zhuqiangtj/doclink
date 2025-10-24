-- CreateTable
CREATE TABLE "PatientNotification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PatientNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientNotification_userId_idx" ON "PatientNotification"("userId");

-- AddForeignKey
ALTER TABLE "PatientNotification" ADD CONSTRAINT "PatientNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
