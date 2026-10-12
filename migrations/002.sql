CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY,window_start timestamptz NOT NULL DEFAULT now(),count int NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS routes (user_id uuid PRIMARY KEY REFERENCES users, data jsonb NOT NULL,updated_at timestamptz DEFAULT now());
