-- Moves quarter-only targets to flexible periods (month, quarter, 6 months, year).
-- Run once on a database that still has "Target".quarter, BEFORE `npx prisma db push`:
--   psql "$DATABASE_URL" -f scripts/migrate-target-periods.sql
-- Safe to run again: it only adds what is missing and fills rows not filled yet.
DO $$ BEGIN
  CREATE TYPE "TargetPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Target"
  ADD COLUMN IF NOT EXISTS "periodType" "TargetPeriod" NOT NULL DEFAULT 'QUARTERLY',
  ADD COLUMN IF NOT EXISTS "periodKey" TEXT,
  ADD COLUMN IF NOT EXISTS "periodStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "periodEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "level" INTEGER NOT NULL DEFAULT 1;

-- Every existing target was quarterly: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar of the next year
UPDATE "Target" t SET
  "periodKey" = t.quarter::text,
  "periodStart" = s.start,
  "periodEnd" = s.start + interval '3 months' - interval '1 second'
FROM (
  SELECT id, make_timestamp(
    substring("financialYear" from '\d{4}')::int + CASE WHEN quarter = 'Q4' THEN 1 ELSE 0 END,
    CASE quarter WHEN 'Q1' THEN 4 WHEN 'Q2' THEN 7 WHEN 'Q3' THEN 10 ELSE 1 END, 1, 0, 0, 0) AS start
  FROM "Target"
) s
WHERE s.id = t.id AND t."periodKey" IS NULL;
