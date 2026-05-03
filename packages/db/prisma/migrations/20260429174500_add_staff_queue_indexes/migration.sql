-- Support the staff queue board polling path.
CREATE INDEX "Queue_siteId_createdAt_idx" ON "Queue"("siteId", "createdAt");
CREATE INDEX "Ticket_siteId_status_createdAt_idx" ON "Ticket"("siteId", "status", "createdAt");
CREATE INDEX "Ticket_siteId_status_queueId_createdAt_idx" ON "Ticket"("siteId", "status", "queueId", "createdAt");
