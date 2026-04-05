ALTER TABLE "User"
ADD COLUMN "socialSecurityNumber" TEXT;

CREATE UNIQUE INDEX "User_socialSecurityNumber_key"
ON "User"("socialSecurityNumber");
