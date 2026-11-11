-- F-208: threaded support replies. Previously a ticket held a single
-- adminReply string, so a second reply silently overwrote the first and
-- users could never follow up. New rows carry the thread; adminReply stays
-- as the latest-admin-reply mirror for backward compatibility.
CREATE TYPE "SupportReplyAuthor" AS ENUM ('USER', 'ADMIN');

CREATE TABLE "SupportTicketReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorRole" "SupportReplyAuthor" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicketReply_ticketId_createdAt_idx" ON "SupportTicketReply"("ticketId", "createdAt");

ALTER TABLE "SupportTicketReply" ADD CONSTRAINT "SupportTicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: preserve every existing admin reply as the thread's ADMIN row.
INSERT INTO "SupportTicketReply" ("id", "ticketId", "authorRole", "message", "createdAt")
SELECT gen_random_uuid(), "id", 'ADMIN', "adminReply", COALESCE("repliedAt", "createdAt")
FROM "SupportTicket"
WHERE "adminReply" IS NOT NULL;
