-- F-004: Favorite.professionalId becomes a real FK (delete cascades, orphans impossible).
-- REVIEW BEFORE PROD: the first statement removes Favorite rows whose
-- professional no longer exists. Those rows render as broken null cards today
-- (favorites.service list maps them to `professional: null`), so this only
-- deletes pointers that already point at nothing. No other data changes.
DELETE FROM "Favorite" WHERE "professionalId" NOT IN (SELECT "id" FROM "ProfessionalProfile");
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F-010: relational settlement membership. paymentIds[] stays untouched as the
-- immutable snapshot; the junction backfills from it for every existing row.
CREATE TABLE "SettlementPayment" (
    "settlementId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementPayment_pkey" PRIMARY KEY ("settlementId","paymentId")
);
CREATE INDEX "SettlementPayment_paymentId_idx" ON "SettlementPayment"("paymentId");
ALTER TABLE "SettlementPayment" ADD CONSTRAINT "SettlementPayment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CommissionSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementPayment" ADD CONSTRAINT "SettlementPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Backfill (idempotent: PK prevents duplicates on retry; skips ids whose
-- Payment row is gone so the FK never fails on legacy data).
INSERT INTO "SettlementPayment" ("settlementId", "paymentId", "createdAt")
SELECT s."id", pid, s."createdAt"
FROM "CommissionSettlement" s
CROSS JOIN LATERAL unnest(s."paymentIds") AS pid
WHERE EXISTS (SELECT 1 FROM "Payment" p WHERE p."id" = pid)
ON CONFLICT DO NOTHING;
