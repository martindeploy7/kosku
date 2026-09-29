-- Letterhead: the merged agreement PDF can show a property-specific logo
-- (header) and contact email (footer), alongside the existing owner
-- signature. No new column: these live in the existing `agreement` jsonb,
-- backfilled here so every row matches the AgreementSettings type.
UPDATE "properties"
SET "agreement" = "agreement" || '{"logoFileId": null, "contactEmail": ""}'::jsonb
WHERE NOT ("agreement" ? 'logoFileId');
