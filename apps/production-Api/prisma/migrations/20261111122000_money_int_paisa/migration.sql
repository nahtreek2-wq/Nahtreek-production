-- F-005: edge money columns from DOUBLE PRECISION (rupees) to INTEGER (paisa).
-- Column names stay the same (Prisma @map renames the fields), so this is a
-- pure type conversion. ROUND(x*100) is exact for all 2-decimal rupee values;
-- NULLs stay NULL. Sub-paisa fractions (beyond 2 decimals) round to the
-- nearest paisa — the smallest representable INR unit.
ALTER TABLE "ProfessionalProfile" ALTER COLUMN "startingPrice" TYPE INTEGER USING (ROUND("startingPrice" * 100)::INTEGER);
ALTER TABLE "ServiceJourney" ALTER COLUMN "quoteAmount" TYPE INTEGER USING (ROUND("quoteAmount" * 100)::INTEGER);
ALTER TABLE "EngineerProfile" ALTER COLUMN "consultationFee" TYPE INTEGER USING (ROUND("consultationFee" * 100)::INTEGER);
ALTER TABLE "EngineerRequest" ALTER COLUMN "budgetEstimate" TYPE INTEGER USING (ROUND("budgetEstimate" * 100)::INTEGER);
