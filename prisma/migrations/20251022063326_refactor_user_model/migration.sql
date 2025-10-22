/*
  Warnings:

  - You are about to drop the column `userEmail` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Doctor` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Patient` table. All the data in the column will be lost.
  - Added the required column `name` to the `User` table without a default value. This is not possible if the table is not empty.
  - Made the column `password` on table `User` required. This step will fail if there are existing NULL values in that column.
  - Made the column `username` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "public"."Patient_phone_key";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "userEmail",
ADD COLUMN     "userUsername" TEXT;

-- AlterTable
ALTER TABLE "Doctor" DROP COLUMN "name";

-- AlterTable
ALTER TABLE "Patient" DROP COLUMN "name",
DROP COLUMN "phone";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "name" TEXT, -- Temporarily nullable
ADD COLUMN     "phone" TEXT;

-- Step 1: Update existing users with default values for new required fields
UPDATE "User" SET "name" = 'Default User' WHERE "name" IS NULL;
UPDATE "User" SET "username" = 'default_user_' || "id" WHERE "username" IS NULL;
UPDATE "User" SET "password" = '$2b$10$iVyme4Au.sxRJ/mMFIxD/e6J/JXAL47m0MOkcpuoEpstRU3dDUpd.' WHERE "password" IS NULL;

-- Step 2: Now alter columns to be NOT NULL
ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "password" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- DropIndex (if email is no longer unique, this index might need to be dropped or modified)
-- For now, keeping email unique as per schema, so no change here.

-- CreateIndex (if any new unique constraints were added, they would be here)

-- AddForeignKey (if any new foreign keys were added, they would be here)