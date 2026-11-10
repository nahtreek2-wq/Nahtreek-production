-- One conversation per request: the findFirst-then-create race (double-tap,
-- retry) used to mint duplicate chat rows for the same job. Keep the oldest
-- conversation per request, move stray messages into it, then enforce
-- uniqueness. NULL request ids stay non-unique (Postgres treats NULLs as
-- distinct), so service/engineer conversations coexist.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "engineerRequestId" ORDER BY "createdAt" ASC) AS rn,
    FIRST_VALUE("id") OVER (PARTITION BY "engineerRequestId" ORDER BY "createdAt" ASC) AS keeper
  FROM "Conversation" WHERE "engineerRequestId" IS NOT NULL
)
UPDATE "Message" SET "conversationId" = ranked.keeper
FROM ranked WHERE "Message"."conversationId" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "engineerRequestId" ORDER BY "createdAt" ASC) AS rn
  FROM "Conversation" WHERE "engineerRequestId" IS NOT NULL
)
DELETE FROM "ConversationParticipant" USING ranked
WHERE "ConversationParticipant"."conversationId" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "engineerRequestId" ORDER BY "createdAt" ASC) AS rn
  FROM "Conversation" WHERE "engineerRequestId" IS NOT NULL
)
DELETE FROM "Conversation" USING ranked WHERE "Conversation"."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "serviceRequestId" ORDER BY "createdAt" ASC) AS rn,
    FIRST_VALUE("id") OVER (PARTITION BY "serviceRequestId" ORDER BY "createdAt" ASC) AS keeper
  FROM "Conversation" WHERE "serviceRequestId" IS NOT NULL
)
UPDATE "Message" SET "conversationId" = ranked.keeper
FROM ranked WHERE "Message"."conversationId" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "serviceRequestId" ORDER BY "createdAt" ASC) AS rn
  FROM "Conversation" WHERE "serviceRequestId" IS NOT NULL
)
DELETE FROM "ConversationParticipant" USING ranked
WHERE "ConversationParticipant"."conversationId" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "serviceRequestId" ORDER BY "createdAt" ASC) AS rn
  FROM "Conversation" WHERE "serviceRequestId" IS NOT NULL
)
DELETE FROM "Conversation" USING ranked WHERE "Conversation"."id" = ranked."id" AND ranked.rn > 1;

DROP INDEX IF EXISTS "Conversation_engineerRequestId_idx";
DROP INDEX IF EXISTS "Conversation_serviceRequestId_idx";
CREATE UNIQUE INDEX "Conversation_engineerRequestId_key" ON "Conversation"("engineerRequestId");
CREATE UNIQUE INDEX "Conversation_serviceRequestId_key" ON "Conversation"("serviceRequestId");
