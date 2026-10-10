-- Up Migration
-- Full-text search next to the vectors. English stemming lets "exporting invoices" match
-- "export" and "invoice"; the column is computed by Postgres, so ingestion needs no changes.
ALTER TABLE chunks
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX idx_chunks_tsv ON chunks USING gin (tsv);

-- Conversation list: a title (the first question) and the time of the last message
ALTER TABLE conversations
  ADD COLUMN title text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE conversations c
SET title = (
      SELECT left(m.content, 80) FROM messages m
      WHERE m.conversation_id = c.id AND m.role = 'user'
      ORDER BY m.id LIMIT 1
    ),
    updated_at = COALESCE(
      (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
      c.created_at
    );

DROP INDEX idx_conversations_user;
CREATE INDEX idx_conversations_user_updated ON conversations (user_id, updated_at DESC);

-- Down Migration
DROP INDEX idx_conversations_user_updated;
CREATE INDEX idx_conversations_user ON conversations (user_id, created_at DESC);
ALTER TABLE conversations DROP COLUMN updated_at, DROP COLUMN title;
DROP INDEX idx_chunks_tsv;
ALTER TABLE chunks DROP COLUMN tsv;
