/*
  Warnings:

  - You are about to drop the `_DoctorToRoom` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `doctorId` to the `Room` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."_DoctorToRoom" DROP CONSTRAINT "_DoctorToRoom_A_fkey";

-- DropForeignKey
ALTER TABLE "public"."_DoctorToRoom" DROP CONSTRAINT "_DoctorToRoom_B_fkey";

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "doctorId" TEXT NOT NULL;

-- DropTable
DROP TABLE "public"."_DoctorToRoom";

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
