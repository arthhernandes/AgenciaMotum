CREATE TABLE "NcmEntry" (
  "code" TEXT NOT NULL,
  "formattedCode" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "fullDescription" TEXT NOT NULL,
  "searchText" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "parentCode" TEXT,
  "validFrom" DATE,
  "validUntil" DATE,
  "legalAct" TEXT,
  "legalNumber" TEXT,
  "legalYear" INTEGER,
  "source" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "referenceDate" DATE NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NcmEntry_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "NcmEntry_code_check" CHECK ("code" ~ '^[0-9]{2,8}$' AND "level" = length("code"))
);
CREATE INDEX "NcmEntry_parentCode_idx" ON "NcmEntry"("parentCode");
CREATE INDEX "NcmEntry_level_idx" ON "NcmEntry"("level");
