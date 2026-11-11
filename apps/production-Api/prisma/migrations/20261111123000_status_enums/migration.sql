-- F-006: String statuses become native enums. Labels match the legacy strings
-- exactly, so stored values and the API wire format are unchanged.
-- Each guard fails the migration with a clear message instead of casting
-- unknown legacy values — review the offending rows before retrying.

-- One-off: a manual push test from 2026-09-24 used an ad-hoc kind. Remap
-- that single synthetic row to 'system' (verified: exactly 1 row, staging).
UPDATE "Notification" SET "kind" = 'system' WHERE "kind" = 'push_acceptance_test_20260924';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ServiceJourney" WHERE "stage" NOT IN
      ('PENDING','ACCEPTED','DECLINED','EN_ROUTE','ARRIVED','IN_PROGRESS','AWAITING_CONFIRMATION','DISPUTED','COMPLETED','CANCELLED','EXPIRED')) THEN
    RAISE EXCEPTION 'ServiceJourney.stage has unknown legacy values';
  END IF;
  IF EXISTS (SELECT 1 FROM "ServiceJourney" WHERE "collectionMode" NOT IN ('ONLINE','AT_HOME')) THEN
    RAISE EXCEPTION 'ServiceJourney.collectionMode has unknown legacy values';
  END IF;
  IF EXISTS (SELECT 1 FROM "Payment" WHERE "collectionMode" NOT IN ('ONLINE','AT_HOME')) THEN
    RAISE EXCEPTION 'Payment.collectionMode has unknown legacy values';
  END IF;
  IF EXISTS (SELECT 1 FROM "CommissionSettlement" WHERE "status" NOT IN ('ORDER_CREATED','SETTLED','FAILED')) THEN
    RAISE EXCEPTION 'CommissionSettlement.status has unknown legacy values';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProfessionalPenalty" WHERE "status" NOT IN ('PENDING','SETTLED')) THEN
    RAISE EXCEPTION 'ProfessionalPenalty.status has unknown legacy values';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProfessionalPenalty" WHERE "reason" NOT IN ('LATE_ACCEPT','LATE_ARRIVAL')) THEN
    RAISE EXCEPTION 'ProfessionalPenalty.reason has unknown legacy values';
  END IF;
  IF EXISTS (SELECT 1 FROM "Notification" WHERE "pushState" NOT IN ('PENDING','SKIPPED','FAILED','SENT')) THEN
    RAISE EXCEPTION 'Notification.pushState has unknown legacy values';
  END IF;
  IF EXISTS (SELECT 1 FROM "Notification" WHERE "kind" NOT IN
      ('chat','engineer','membership','message','offer','payment','reminder','request','review','service','support','system','tracking','verification')) THEN
    RAISE EXCEPTION 'Notification.kind has unknown legacy values';
  END IF;
END $$;

CREATE TYPE "JourneyStage" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "CollectionMode" AS ENUM ('ONLINE', 'AT_HOME');
CREATE TYPE "SettlementStatus" AS ENUM ('ORDER_CREATED', 'SETTLED', 'FAILED');
CREATE TYPE "PenaltyStatus" AS ENUM ('PENDING', 'SETTLED');
CREATE TYPE "PenaltyReason" AS ENUM ('LATE_ACCEPT', 'LATE_ARRIVAL');
CREATE TYPE "PushState" AS ENUM ('PENDING', 'SKIPPED', 'FAILED', 'SENT');
CREATE TYPE "NotificationKind" AS ENUM ('chat', 'engineer', 'membership', 'message', 'offer', 'payment', 'reminder', 'request', 'review', 'service', 'support', 'system', 'tracking', 'verification');

ALTER TABLE "ServiceJourney" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "ServiceJourney" ALTER COLUMN "stage" SET DATA TYPE "JourneyStage" USING ("stage"::text::"JourneyStage");
ALTER TABLE "ServiceJourney" ALTER COLUMN "stage" SET DEFAULT 'PENDING';
ALTER TABLE "ServiceJourney" ALTER COLUMN "collectionMode" DROP DEFAULT;
ALTER TABLE "ServiceJourney" ALTER COLUMN "collectionMode" SET DATA TYPE "CollectionMode" USING ("collectionMode"::text::"CollectionMode");
ALTER TABLE "ServiceJourney" ALTER COLUMN "collectionMode" SET DEFAULT 'ONLINE';
ALTER TABLE "Payment" ALTER COLUMN "collectionMode" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "collectionMode" SET DATA TYPE "CollectionMode" USING ("collectionMode"::text::"CollectionMode");
ALTER TABLE "Payment" ALTER COLUMN "collectionMode" SET DEFAULT 'ONLINE';
ALTER TABLE "CommissionSettlement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CommissionSettlement" ALTER COLUMN "status" SET DATA TYPE "SettlementStatus" USING ("status"::text::"SettlementStatus");
ALTER TABLE "CommissionSettlement" ALTER COLUMN "status" SET DEFAULT 'ORDER_CREATED';
ALTER TABLE "ProfessionalPenalty" ALTER COLUMN "reason" DROP DEFAULT;
ALTER TABLE "ProfessionalPenalty" ALTER COLUMN "reason" SET DATA TYPE "PenaltyReason" USING ("reason"::text::"PenaltyReason");
ALTER TABLE "ProfessionalPenalty" ALTER COLUMN "reason" SET DEFAULT 'LATE_ARRIVAL';
ALTER TABLE "ProfessionalPenalty" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ProfessionalPenalty" ALTER COLUMN "status" SET DATA TYPE "PenaltyStatus" USING ("status"::text::"PenaltyStatus");
ALTER TABLE "ProfessionalPenalty" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "Notification" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "kind" SET DATA TYPE "NotificationKind" USING ("kind"::text::"NotificationKind");
ALTER TABLE "Notification" ALTER COLUMN "kind" SET DEFAULT 'system';
ALTER TABLE "Notification" ALTER COLUMN "pushState" DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "pushState" SET DATA TYPE "PushState" USING ("pushState"::text::"PushState");
ALTER TABLE "Notification" ALTER COLUMN "pushState" SET DEFAULT 'PENDING';
