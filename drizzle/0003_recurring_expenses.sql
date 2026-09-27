ALTER TABLE "expenses" ADD COLUMN "recurrence" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurrence_end_date" date;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurrence_parent_id" uuid;--> statement-breakpoint
UPDATE "expenses" SET "recurrence" = 'monthly' WHERE "recurring" = true;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrence_value_ck"
  CHECK ("recurrence" IS NULL OR "recurrence" IN ('weekly', 'monthly', 'yearly'));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrence_shape_ck"
  CHECK (
    ("recurring" = true AND "recurrence" IS NOT NULL AND "recurrence_parent_id" IS NULL)
    OR
    ("recurring" = false AND "recurrence" IS NULL AND "recurrence_end_date" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrence_end_ck"
  CHECK ("recurrence_end_date" IS NULL OR "recurrence_end_date" >= "date");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrence_parent_id_expenses_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurrence_instance_uq" ON "expenses" USING btree ("recurrence_parent_id","date");
