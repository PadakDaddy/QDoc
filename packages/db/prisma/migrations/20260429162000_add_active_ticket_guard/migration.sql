-- Keep one active ticket per user and site at the database boundary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Ticket"
    WHERE "status" IN ('waiting', 'called', 'in_service')
    GROUP BY "siteId", "userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create Ticket_active_site_user_key while duplicate active tickets exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "Ticket_active_site_user_key"
ON "Ticket"("siteId", "userId")
WHERE "status" IN ('waiting', 'called', 'in_service');
