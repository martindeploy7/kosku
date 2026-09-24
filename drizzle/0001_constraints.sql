-- Rules the database itself enforces, so no code path (or future bug) can break them.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- A room can never hold two live leases over overlapping dates. Covers both
-- DP bookings and active rentals; an open-ended lease (end_date NULL) blocks
-- the room indefinitely. Ended, lapsed, cancelled and soft-deleted leases
-- drop out of the constraint, which is exactly what frees the room again.
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_no_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    daterange("start_date", "end_date", '[)') WITH &&
  )
  WHERE ("status" IN ('booked', 'active') AND "deleted_at" IS NULL);
--> statement-breakpoint

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_dates_ck"
  CHECK ("end_date" IS NULL OR "end_date" > "start_date");
--> statement-breakpoint

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_booked_deadline_ck"
  CHECK ("status" <> 'booked' OR "payment_deadline" IS NOT NULL);
--> statement-breakpoint

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_billing_day_ck"
  CHECK ("billing_day" BETWEEN 1 AND 31);
--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_ck"
  CHECK ("subtotal" >= 0 AND "late_fee" >= 0 AND "total" = "subtotal" + "late_fee");
--> statement-breakpoint

-- A payment is never zero. Refunds and reversals are negative.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_ck" CHECK ("amount" <> 0);
