-- Workspaces: every superadmin manages only the properties they own; a developer
-- gets an isolated sandbox. Existing data belongs to the first superadmin.
ALTER TABLE "users" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "trash" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
UPDATE "users" SET "owner_id" = "id" WHERE "role" IN ('superadmin', 'developer');--> statement-breakpoint
UPDATE "users" SET "owner_id" = (SELECT "id" FROM "users" WHERE "role" = 'superadmin' ORDER BY "created_at" LIMIT 1) WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "properties" SET "owner_id" = (SELECT "id" FROM "users" WHERE "role" = 'superadmin' ORDER BY "created_at" LIMIT 1) WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "tenants" SET "owner_id" = (SELECT "id" FROM "users" WHERE "role" = 'superadmin' ORDER BY "created_at" LIMIT 1) WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "notifications" n SET "owner_id" = COALESCE((SELECT "owner_id" FROM "properties" p WHERE p."id" = n."property_id"), (SELECT "owner_id" FROM "users" u WHERE u."id" = n."user_id")) WHERE n."owner_id" IS NULL;--> statement-breakpoint
UPDATE "approval_requests" a SET "owner_id" = (SELECT "owner_id" FROM "users" u WHERE u."id" = a."requested_by");--> statement-breakpoint
UPDATE "trash" t SET "owner_id" = COALESCE((SELECT "owner_id" FROM "properties" p WHERE p."id" = t."property_id"), (SELECT "owner_id" FROM "users" u WHERE u."id" = t."deleted_by"));--> statement-breakpoint
UPDATE "audit_logs" l SET "owner_id" = COALESCE((SELECT "owner_id" FROM "properties" p WHERE p."id" = l."property_id"), (SELECT "owner_id" FROM "users" u WHERE u."id" = l."user_id"));--> statement-breakpoint
-- Workspace-wide settings move from the single "app" key to one row per owner.
INSERT INTO "settings" ("key", "value") SELECT 'app:' || u."id", s."value" FROM "settings" s CROSS JOIN "users" u WHERE s."key" = 'app' AND u."role" = 'superadmin' ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Property codes prefix invoice numbers: make duplicates unique before enforcing it.
UPDATE "properties" p SET "code" = upper(p."code") || d."rn" FROM (SELECT "id", row_number() OVER (PARTITION BY upper("code") ORDER BY "created_at") - 1 AS "rn" FROM "properties") d WHERE d."id" = p."id" AND d."rn" > 0;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_code_uq" ON "properties" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "properties_owner_idx" ON "properties" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "tenants_owner_idx" ON "tenants" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "users_owner_idx" ON "users" USING btree ("owner_id");
