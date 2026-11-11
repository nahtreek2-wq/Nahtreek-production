-- F-003: indexes for verified read paths (all additive, no data change).
-- Review card/history reads, audit history + admin activity feeds,
-- OTP expiry hygiene, portfolio/history includes, user-first chat scans.
CREATE INDEX "RequestStatusHistory_engineerRequestId_createdAt_idx" ON "RequestStatusHistory"("engineerRequestId", "createdAt");
CREATE INDEX "Review_professionalProfileId_createdAt_idx" ON "Review"("professionalProfileId", "createdAt");
CREATE INDEX "Review_clientProfileId_createdAt_idx" ON "Review"("clientProfileId", "createdAt");
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");
CREATE INDEX "PortfolioItem_professionalProfileId_createdAt_idx" ON "PortfolioItem"("professionalProfileId", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");
