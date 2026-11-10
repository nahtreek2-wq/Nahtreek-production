-- Pro payout self-service: bank account + IFSC + UPI collection. The API only
-- ever reads back masked values; the full number exists for the future
-- Razorpay Route onboarding verification.
ALTER TABLE "PayoutAccount" ADD COLUMN "accountNumber" TEXT;
ALTER TABLE "PayoutAccount" ADD COLUMN "ifsc" TEXT;
ALTER TABLE "PayoutAccount" ADD COLUMN "upiId" TEXT;
