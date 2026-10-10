-- Up Migration
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('md', 'pdf', 'url')),
  source_ref  text,                         -- original URL or file name
  status      text NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id          bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord         int NOT NULL,                 -- position inside the document
  content     text NOT NULL,
  tokens      int NOT NULL,
  embedding   vector(1536) NOT NULL,
  UNIQUE (document_id, ord)
);

-- HNSW gives fast approximate nearest-neighbour search on cosine distance
CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_document ON chunks (document_id);

CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_user ON conversations (user_id, created_at DESC);

CREATE TABLE messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  citations       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, id);

CREATE TABLE usage (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  input_tokens  int NOT NULL,
  output_tokens int NOT NULL,
  cost_usd      numeric(12, 6) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Daily per-user limit check: sum tokens for one user since midnight
CREATE INDEX idx_usage_user_day ON usage (user_id, created_at);

-- Down Migration
DROP TABLE usage;
DROP TABLE messages;
DROP TABLE conversations;
DROP TABLE chunks;
DROP TABLE documents;
