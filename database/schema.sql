-- ====================================================================
-- GoldenPalm — Database Schema
-- Compatible with PostgreSQL (Supabase, Vercel Postgres, Neon, RDS)
-- Run once on a fresh database. Idempotent — safe to re-run.
-- ====================================================================

-- ---------- Extensions ----------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";          -- case-insensitive email

-- ---------- Customers ----------
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  phone         TEXT,
  password_hash TEXT,                              -- bcrypt/argon2 only — NEVER plaintext
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Products ----------
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,                    -- e.g. 'red', 'organic'
  name        TEXT NOT NULL,
  description TEXT,
  price_usd   NUMERIC(10, 2) NOT NULL CHECK (price_usd >= 0),
  image_url   TEXT,
  in_stock    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO products (id, name, price_usd) VALUES
  ('red',     'Red Palm Oil',     8.50),
  ('refined', 'Refined Palm Oil', 6.20),
  ('kernel',  'Palm Kernel Oil',  9.10),
  ('organic', 'Organic Palm Oil', 11.00)
ON CONFLICT (id) DO NOTHING;

-- ---------- Orders ----------
CREATE TYPE order_status AS ENUM (
  'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'
);

CREATE TYPE payment_method AS ENUM (
  'bank_ngn', 'bank_usd', 'crypto_bep20'
);

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  email           CITEXT NOT NULL,
  total_usd       NUMERIC(12, 2) NOT NULL CHECK (total_usd >= 0),
  currency        TEXT NOT NULL DEFAULT 'USD',
  payment_method  payment_method NOT NULL,
  status          order_status NOT NULL DEFAULT 'pending',
  tx_hash         TEXT,                            -- for BEP20 payments
  reference       TEXT UNIQUE,                     -- bank transfer reference
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at DESC);

-- ---------- Order items ----------
CREATE TABLE IF NOT EXISTS order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id),
  qty         INT NOT NULL CHECK (qty > 0 AND qty <= 99),
  unit_price  NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- ---------- Contact submissions ----------
CREATE TABLE IF NOT EXISTS contact_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      CITEXT NOT NULL,
  message    TEXT NOT NULL,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Audit / security log ----------
CREATE TABLE IF NOT EXISTS security_events (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,                       -- login_success, login_fail, password_reset, etc.
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  email       CITEXT,
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_email   ON security_events(email);
CREATE INDEX IF NOT EXISTS idx_sec_type    ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sec_created ON security_events(created_at DESC);

-- ---------- Visits / daily traffic ----------
CREATE TABLE IF NOT EXISTS visits (
  id          BIGSERIAL PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  fingerprint TEXT NOT NULL,
  path        TEXT NOT NULL,
  day         DATE NOT NULL DEFAULT CURRENT_DATE,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visits_day  ON visits(day);
CREATE INDEX IF NOT EXISTS idx_visits_fp   ON visits(fingerprint);
CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(customer_id);

-- View: daily unique visitors
CREATE OR REPLACE VIEW daily_visitors AS
  SELECT day, COUNT(DISTINCT fingerprint) AS unique_visitors, COUNT(*) AS total_hits
  FROM visits GROUP BY day ORDER BY day DESC;

-- ---------- Rewards / loyalty ----------
CREATE TABLE IF NOT EXISTS rewards (
  customer_id        UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  points             INT  NOT NULL DEFAULT 0 CHECK (points >= 0),
  lifetime_points    INT  NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  streak             INT  NOT NULL DEFAULT 0 CHECK (streak >= 0),
  last_checkin       DATE,
  last_checkin_ts    TIMESTAMPTZ,
  last_redeem_ts     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_rewards_updated ON rewards;
CREATE TRIGGER trg_rewards_updated BEFORE UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- Rate-limit buckets ----------
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,                     -- e.g. 'login:1.2.3.4', 'contact:1.2.3.4'
  hits       INT NOT NULL DEFAULT 0,
  window_end TIMESTAMPTZ NOT NULL
);

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ====================================================================
-- Row-Level Security  (Supabase / Postgres-native)
-- Customers can only read and modify their own rows.
-- ====================================================================
ALTER TABLE customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items   ENABLE ROW LEVEL SECURITY;

-- Auth helper: auth.uid() returns the authenticated user's UUID (Supabase)
DROP POLICY IF EXISTS p_customers_self ON customers;
CREATE POLICY p_customers_self ON customers
  FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS p_orders_self ON orders;
CREATE POLICY p_orders_self ON orders
  FOR SELECT USING (customer_id = auth.uid());

DROP POLICY IF EXISTS p_orders_insert_self ON orders;
CREATE POLICY p_orders_insert_self ON orders
  FOR INSERT WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS p_items_via_order ON order_items;
CREATE POLICY p_items_via_order ON order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.customer_id = auth.uid())
  );

-- products are public read
GRANT SELECT ON products TO anon, authenticated;
