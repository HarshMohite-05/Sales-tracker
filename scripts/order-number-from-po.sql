-- Makes each existing order's number its client PO number (new orders get it when they are created).
-- Run once on a database after deploying that change:
--   psql "$DATABASE_URL" -f scripts/order-number-from-po.sql
-- Orders with no PO ("Verbal / Direct Confirmed") keep their ORD- number, and so does any order whose
-- PO number is shared with another order, since order numbers must be unique. Safe to run again.
UPDATE "Order" o SET "orderNumber" = trim(o."clientPoNumber")
WHERE o."clientPoNumber" IS NOT NULL
  AND trim(o."clientPoNumber") <> ''
  AND o."clientPoNumber" <> 'Verbal / Direct Confirmed'
  AND o."orderNumber" <> trim(o."clientPoNumber")
  AND (SELECT count(*) FROM "Order" x WHERE trim(x."clientPoNumber") = trim(o."clientPoNumber")) = 1
  AND NOT EXISTS (SELECT 1 FROM "Order" y WHERE y."orderNumber" = trim(o."clientPoNumber") AND y.id <> o.id);

-- Orders that kept their ORD- number because their PO number is shared or missing
SELECT "orderNumber", "clientPoNumber" FROM "Order" WHERE "orderNumber" <> coalesce(trim("clientPoNumber"), '');
