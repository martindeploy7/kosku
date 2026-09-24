CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"property_id" uuid,
	"label" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"reviewed_by" uuid,
	"reviewed_by_name" text,
	"review_note" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_uq" ON "approval_requests" USING btree ("kind","entity_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status","created_at");