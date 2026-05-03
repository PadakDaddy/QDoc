ALTER TYPE "TicketStatus" RENAME VALUE 'no_show' TO 'delay';

ALTER TABLE "Site" ADD COLUMN "distanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "Site" SET "distanceKm" = 1.2 WHERE "id" = 'site-downtown';
UPDATE "Site" SET "distanceKm" = 3.6 WHERE "id" = 'site-northside';

ALTER TABLE "Ticket" ADD COLUMN "sortRank" TIMESTAMP(3);
UPDATE "Ticket" SET "sortRank" = "createdAt";
ALTER TABLE "Ticket" ALTER COLUMN "sortRank" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "sortRank" SET DEFAULT CURRENT_TIMESTAMP;

DROP INDEX IF EXISTS "Ticket_active_site_user_key";
CREATE UNIQUE INDEX "Ticket_active_site_user_key"
ON "Ticket"("siteId", "userId")
WHERE "status" IN ('waiting', 'called', 'in_service', 'delay');

CREATE INDEX "Ticket_siteId_status_queueId_sortRank_idx"
ON "Ticket"("siteId", "status", "queueId", "sortRank");
