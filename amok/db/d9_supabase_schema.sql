-- ============================================================
-- D9 Token Staking + Upgrade System — Supabase Schema
-- 4dnft.com | Hybrid Architecture
-- ============================================================

-- ============================================================
-- TIERS TABLE
-- Define upgrade tiers and their D9 thresholds
-- Update this table freely — no contract redeploy needed
-- ============================================================
CREATE TABLE tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,          -- e.g. 'Seed', 'Growth', 'Delta', 'Elite'
  d9_threshold  NUMERIC NOT NULL,              -- minimum D9 staked to reach this tier
  perks         JSONB DEFAULT '[]',            -- array of feature strings unlocked
  reward_boost  NUMERIC DEFAULT 1.0,           -- multiplier on base rewards (1.0 = no boost)
  sort_order    INT NOT NULL DEFAULT 0,        -- for display ordering
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default tiers
INSERT INTO tiers (name, d9_threshold, perks, reward_boost, sort_order) VALUES
  ('Seed',   100,    '["Basic access", "Standard rewards"]',            1.0,  1),
  ('Growth', 500,    '["Basic access", "Rewards boost", "Early access"]', 1.25, 2),
  ('Delta',  2000,   '["Full upgrade suite", "2x rewards", "Priority support"]', 2.0, 3),
  ('Elite',  10000,  '["All features", "3x rewards", "Exclusive drops", "DAO voting"]', 3.0, 4);


-- ============================================================
-- WALLETS TABLE
-- One row per connected Phantom wallet
-- ============================================================
CREATE TABLE wallets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address      TEXT NOT NULL UNIQUE,       -- Solana public key
  tier_id             UUID REFERENCES tiers(id),  -- current tier (null = no stake)
  staked_amount       NUMERIC DEFAULT 0,          -- D9 tokens currently staked (synced from chain)
  total_staked_ever   NUMERIC DEFAULT 0,          -- lifetime staking total
  rewards_accrued     NUMERIC DEFAULT 0,          -- unclaimed rewards balance
  rewards_claimed     NUMERIC DEFAULT 0,          -- lifetime claimed rewards
  last_synced_at      TIMESTAMPTZ,                -- last time on-chain balance was synced
  joined_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast wallet lookups
CREATE INDEX idx_wallets_address ON wallets(wallet_address);
CREATE INDEX idx_wallets_tier ON wallets(tier_id);


-- ============================================================
-- STAKE EVENTS TABLE
-- Immutable log of every stake / unstake action
-- ============================================================
CREATE TABLE stake_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN ('stake', 'unstake')),
  amount            NUMERIC NOT NULL,
  tx_signature      TEXT UNIQUE,                 -- Solana transaction signature
  slot              BIGINT,                      -- Solana slot number
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stake_events_wallet ON stake_events(wallet_id);
CREATE INDEX idx_stake_events_tx ON stake_events(tx_signature);


-- ============================================================
-- REWARDS TABLE
-- Tracks reward accrual and claim history
-- ============================================================
CREATE TABLE reward_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN ('accrual', 'claim')),
  amount            NUMERIC NOT NULL,
  tx_signature      TEXT,                        -- populated on claims
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reward_events_wallet ON reward_events(wallet_id);


-- ============================================================
-- UPGRADES TABLE
-- Tracks which upgrades/features each wallet has unlocked
-- Flexible JSONB metadata for future upgrade types
-- ============================================================
CREATE TABLE upgrades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  upgrade_type    TEXT NOT NULL,               -- e.g. '4dnft_access', 'delta9_premium'
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  metadata        JSONB DEFAULT '{}',          -- flexible: expiry, nft_mint, etc.
  unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ                  -- null = no expiry
);

CREATE INDEX idx_upgrades_wallet ON upgrades(wallet_id);
CREATE INDEX idx_upgrades_type ON upgrades(upgrade_type);


-- ============================================================
-- FUNCTION: Auto-update wallet tier based on staked amount
-- Call this after syncing on-chain balance
-- ============================================================
CREATE OR REPLACE FUNCTION update_wallet_tier(p_wallet_id UUID)
RETURNS VOID AS $$
DECLARE
  v_staked    NUMERIC;
  v_tier_id   UUID;
BEGIN
  SELECT staked_amount INTO v_staked FROM wallets WHERE id = p_wallet_id;

  SELECT id INTO v_tier_id
  FROM tiers
  WHERE d9_threshold <= v_staked
  ORDER BY d9_threshold DESC
  LIMIT 1;

  UPDATE wallets
  SET tier_id = v_tier_id, updated_at = NOW()
  WHERE id = p_wallet_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FUNCTION: Sync wallet from on-chain data
-- Called by your backend sync job / webhook
-- ============================================================
CREATE OR REPLACE FUNCTION sync_wallet_stake(
  p_wallet_address  TEXT,
  p_staked_amount   NUMERIC,
  p_tx_signature    TEXT DEFAULT NULL,
  p_event_type      TEXT DEFAULT 'stake'
)
RETURNS UUID AS $$
DECLARE
  v_wallet_id UUID;
  v_prev_staked NUMERIC;
BEGIN
  -- Upsert wallet
  INSERT INTO wallets (wallet_address, staked_amount, last_synced_at)
  VALUES (p_wallet_address, p_staked_amount, NOW())
  ON CONFLICT (wallet_address) DO UPDATE
    SET staked_amount = p_staked_amount,
        last_synced_at = NOW(),
        updated_at = NOW()
  RETURNING id INTO v_wallet_id;

  -- Log stake event if tx provided
  IF p_tx_signature IS NOT NULL THEN
    INSERT INTO stake_events (wallet_id, event_type, amount, tx_signature)
    VALUES (v_wallet_id, p_event_type, p_staked_amount, p_tx_signature)
    ON CONFLICT (tx_signature) DO NOTHING;
  END IF;

  -- Update total_staked_ever on stake
  IF p_event_type = 'stake' THEN
    UPDATE wallets
    SET total_staked_ever = total_staked_ever + p_staked_amount
    WHERE id = v_wallet_id;
  END IF;

  -- Recalculate tier
  PERFORM update_wallet_tier(v_wallet_id);

  RETURN v_wallet_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE wallets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stake_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrades      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiers         ENABLE ROW LEVEL SECURITY;

-- Tiers are public read
CREATE POLICY "tiers_public_read" ON tiers
  FOR SELECT USING (true);

-- Wallets: anyone can read, only service role can write
CREATE POLICY "wallets_public_read" ON wallets
  FOR SELECT USING (true);

CREATE POLICY "wallets_service_write" ON wallets
  FOR ALL USING (auth.role() = 'service_role');

-- Stake events: public read, service role write
CREATE POLICY "stake_events_public_read" ON stake_events
  FOR SELECT USING (true);

CREATE POLICY "stake_events_service_write" ON stake_events
  FOR ALL USING (auth.role() = 'service_role');

-- Reward events: public read, service role write
CREATE POLICY "reward_events_public_read" ON reward_events
  FOR SELECT USING (true);

CREATE POLICY "reward_events_service_write" ON reward_events
  FOR ALL USING (auth.role() = 'service_role');

-- Upgrades: public read, service role write
CREATE POLICY "upgrades_public_read" ON upgrades
  FOR SELECT USING (true);

CREATE POLICY "upgrades_service_write" ON upgrades
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================================
-- HANDY VIEWS
-- ============================================================

-- Full wallet status with tier info
CREATE VIEW wallet_status AS
SELECT
  w.wallet_address,
  w.staked_amount,
  w.rewards_accrued,
  w.rewards_claimed,
  w.last_synced_at,
  t.name          AS tier_name,
  t.d9_threshold  AS tier_threshold,
  t.reward_boost,
  t.perks,
  -- Next tier info
  (SELECT name FROM tiers
   WHERE d9_threshold > w.staked_amount
   ORDER BY d9_threshold ASC LIMIT 1) AS next_tier_name,
  (SELECT d9_threshold FROM tiers
   WHERE d9_threshold > w.staked_amount
   ORDER BY d9_threshold ASC LIMIT 1) AS next_tier_threshold
FROM wallets w
LEFT JOIN tiers t ON w.tier_id = t.id;
