CREATE TABLE IF NOT EXISTS crm_anonymous_saves (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_anonymous_saves_updated_at_idx
  ON crm_anonymous_saves (updated_at);