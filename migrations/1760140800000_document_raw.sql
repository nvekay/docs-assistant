-- Up Migration
-- Uploaded files are kept so the worker can (re)index them without the API holding them in memory
ALTER TABLE documents
  ADD COLUMN raw_content bytea,
  ADD COLUMN mime_type text;

-- Down Migration
ALTER TABLE documents
  DROP COLUMN raw_content,
  DROP COLUMN mime_type;
