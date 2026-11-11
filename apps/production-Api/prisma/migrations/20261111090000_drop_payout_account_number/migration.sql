-- F-001: stop retaining full bank account numbers.
-- The column was write-only: masked views use accountLast4, transfers use
-- providerAccountRef, and the admin link flow supplies its own reference.
-- Dropping it purges existing values from the live database. Pre-migration
-- backups still hold them until their normal rotation; no application code
-- reads this column anymore (submitPayoutAccount keeps the DTO field for
-- API compatibility but persists only the last4).
ALTER TABLE "PayoutAccount" DROP COLUMN "accountNumber";
