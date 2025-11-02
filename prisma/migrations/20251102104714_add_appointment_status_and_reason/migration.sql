/*
  Warnings:

  - The `status` column on the `Appointment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reason" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING';
