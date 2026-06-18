import { useState, useEffect, useCallback } from "react";

// ─── Mock Supabase client (replace with your real @supabase/supabase-js client) ───
const mockWalletData = {
  wallet_address: null,
  staked_amount: 0,
  rewards_accrued: 0,
  rewards_claimed: 0,
  tier_name: null,
  tier_threshold: 0,
  reward_boost: 1.0,
  perks: [],
  next_tier_name: "Seed",
  next_tier_threshold: 100,
};

const TIERS = [
  { name: "Seed",   threshold: 100,   boost: 1.0,  perks: ["Basic access", "Standard rewards"],                          color: "#4ade80" },
  { name: "Growth", threshold: 500,   boost: 1.25, perks: ["Basic access", "Rewards boost", "Early access"],              color: "#22d3ee" },
  { name: "Delta",  threshold: 2000,  boost: 2.0,  perks: ["Full upgrade suite", "2x rewards", "Priority support"],       color: "#a78bfa" },
  { name: "Elite",  threshold: 10000, boost: 3.0,  perks: ["All features", "3x rewards", "Exclusive drops", "DAO voting"], color: "#f59e0b" },
];

// ─── Utility ───────────────────────────────────────────────────────────────────
function getTierColor(tierName) {
  return TIERS.find(t => t.name === tierName)?.color || "#6b7280";
}

function getTierProgress(staked, currentThreshold, nextThreshold) {
  if (!nextThreshold) return 100;
  const range = nextThreshold - currentThreshold;
  const progress = staked - currentThreshold;
  return Math.min(100, Math.max(0, (progress / range) * 100));
}

function formatD9(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n?.toFixed(2) ?? "0";
}

// ─── Components ────────────────────────────────────────────────────────────────

function ConnectButton({ onConnect, connecting }) {
  return (
    <button
      onClick={onConnect}
      disabled={connecting}
      style={{
        background: "linear-gradient(135deg, #9945FF, #14F195)",
        border: "none",
        borderRadius: "12px",
        color: "#000",
        cursor: connecting ? "not-allowed" : "pointer",
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: "16px",
        fontWeight: "700",
        letterSpacing: "0.02em",
        opacity: connecting ? 0.7 : 1,
        padding: "14px 32px",
        transition: "transform 0.15s, opacity 0.15s",
      }}
      onMouseEnter={e => { if (!connecting) e.target.style.transform = "scale(1.03)"; }}
      onMouseLeave={e => { e.target.style.transform = "scale(1)"; }}
    >
      {connecting ? "Connecting…" : "Connect Phantom"}
    </button>
  );
}

function TierBadge({ name }) {
  if (!name) return null;
  const color = getTierColor(name);
  return (
    <span style={{
      background: `${color}22`,
      border: `1px solid ${color}55`,
      borderRadius: "6px",
      color,
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.08em",
      padding: "3px 10px",
      textTransform: "uppercase",
    }}>
      {name}
    </span>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: "#0f0f1a",
      border: "1px solid #1e1e3a",
      borderRadius: "14px",
      padding: "20px 24px",
      flex: 1,
      minWidth: "140px",
    }}>
      <div style={{ color: "#6b6b8a", fontSize: "12px", fontWeight: "600", letterSpacing: "0.08em", marginBottom: "8px", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ color: "#e8e8ff", fontSize: "26px", fontWeight: "700", fontFamily: "'Space Grotesk', sans-serif" }}>
        {value}
      </div>
      {sub && <div style={{ color: "#6b6b8a", fontSize: "12px", marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

function TierProgress({ wallet }) {
  const { staked_amount, tier_name, tier_threshold, next_tier_name, next_tier_threshold } = wallet;
  const progress = getTierProgress(staked_amount, tier_threshold || 0, next_tier_threshold);
  const color = getTierColor(tier_name || "");
  const remaining = next_tier_threshold ? next_tier_threshold - staked_amount : 0;

  return (
    <div style={{
      background: "#0f0f1a",
      border: "1px solid #1e1e3a",
      borderRadius: "14px",
      padding: "24px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div style={{ color: "#e8e8ff", fontWeight: "600" }}>Tier Progress</div>
        <TierBadge name={tier_name} />
      </div>

      <div style={{ background: "#1a1a2e", borderRadius: "8px", height: "8px", marginBottom: "10px", overflow: "hidden" }}>
        <div style={{
          background: tier_name ? `linear-gradient(90deg, ${color}88, ${color})` : "#1e1e3a",
          borderRadius: "8px",
          height: "100%",
          transition: "width 0.6s ease",
          width: `${progress}%`,
        }} />
      </div>

      <div style={{ color: "#6b6b8a", fontSize: "13px" }}>
        {next_tier_name
          ? <>{formatD9(remaining)} D9 more to reach <span style={{ color: getTierColor(next_tier_name) }}>{next_tier_name}</span></>
          : <span style={{ color: "#f59e0b" }}>Maximum tier reached 🏆</span>
        }
      </div>
    </div>
  );
}

function UpgradeBox({ wallet, onStake, onUnstake, staking }) {
  const [amount, setAmount] = useState("");

  const handleStake = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    onStake(n);
    setAmount("");
  };

  const handleUnstake = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    onUnstake(n);
    setAmount("");
  };

  const nextTier = TIERS.find(t => t.name === wallet.next_tier_name);

  return (
    <div style={{
      background: "linear-gradient(145deg, #0f0f1a, #12102a)",
      border: "1px solid #2a1f5a",
      borderRadius: "16px",
      padding: "28px",
    }}>
      <div style={{ color: "#e8e8ff", fontSize: "18px", fontWeight: "700", marginBottom: "6px" }}>
        Upgrade Services
      </div>
      <div style={{ color: "#6b6b8a", fontSize: "13px", marginBottom: "24px" }}>
        Stake D9 tokens to unlock higher tiers and earn boosted rewards
      </div>

      {/* Next tier preview */}
      {nextTier && (
        <div style={{
          background: `${nextTier.color}11`,
          border: `1px solid ${nextTier.color}33`,
          borderRadius: "12px",
          marginBottom: "20px",
          padding: "16px",
        }}>
          <div style={{ color: nextTier.color, fontSize: "12px", fontWeight: "700", letterSpacing: "0.08em", marginBottom: "10px", textTransform: "uppercase" }}>
            Next: {nextTier.name} tier — {formatD9(nextTier.threshold)} D9
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {nextTier.perks.map(p => (
              <span key={p} style={{
                background: "#0f0f1a",
                borderRadius: "6px",
                color: "#a0a0c0",
                fontSize: "12px",
                padding: "4px 10px",
              }}>
                ✦ {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
        <input
          type="number"
          min="0"
          placeholder="Amount of D9"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{
            background: "#0a0a18",
            border: "1px solid #1e1e3a",
            borderRadius: "10px",
            color: "#e8e8ff",
            flex: 1,
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "15px",
            outline: "none",
            padding: "12px 16px",
          }}
        />
        <button
          onClick={handleStake}
          disabled={staking || !amount}
          style={{
            background: staking ? "#1e1e3a" : "linear-gradient(135deg, #9945FF, #14F195)",
            border: "none",
            borderRadius: "10px",
            color: staking ? "#6b6b8a" : "#000",
            cursor: staking || !amount ? "not-allowed" : "pointer",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: "700",
            padding: "12px 22px",
            transition: "opacity 0.15s",
          }}
        >
          {staking ? "Staking…" : "Stake"}
        </button>
        <button
          onClick={handleUnstake}
          disabled={staking || !amount || wallet.staked_amount <= 0}
          style={{
            background: "transparent",
            border: "1px solid #2a1f5a",
            borderRadius: "10px",
            color: "#a0a0c0",
            cursor: staking || !amount ? "not-allowed" : "pointer",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: "600",
            padding: "12px 18px",
            transition: "border-color 0.15s",
          }}
        >
          Unstake
        </button>
      </div>

      <div style={{ color: "#4b4b6a", fontSize: "12px" }}>
        Currently staked: <span style={{ color: "#a0a0c0" }}>{formatD9(wallet.staked_amount)} D9</span>
      </div>
    </div>
  );
}

function TierGrid({ activeTier }) {
  return (
    <div>
      <div style={{ color: "#6b6b8a", fontSize: "12px", fontWeight: "600", letterSpacing: "0.08em", marginBottom: "14px", textTransform: "uppercase" }}>
        All Tiers
      </div>
      <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {TIERS.map(tier => {
          const active = tier.name === activeTier;
          return (
            <div key={tier.name} style={{
              background: active ? `${tier.color}11` : "#0a0a18",
              border: `1px solid ${active ? tier.color + "55" : "#1e1e3a"}`,
              borderRadius: "12px",
              padding: "16px",
              transition: "border-color 0.2s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ color: active ? tier.color : "#a0a0c0", fontWeight: "700", fontSize: "14px" }}>{tier.name}</span>
                {active && <span style={{ background: `${tier.color}22`, borderRadius: "4px", color: tier.color, fontSize: "10px", fontWeight: "700", padding: "2px 7px" }}>ACTIVE</span>}
              </div>
              <div style={{ color: "#6b6b8a", fontSize: "12px", marginBottom: "10px" }}>{formatD9(tier.threshold)} D9 min</div>
              <div style={{ color: "#4b4b6a", fontSize: "11px" }}>{tier.boost}x rewards</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function D9Dashboard() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [wallet, setWallet] = useState(mockWalletData);
  const [staking, setStaking] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Simulate Phantom connect — replace with real wallet adapter
  const connectWallet = useCallback(async () => {
    setConnecting(true);
    try {
      // Real implementation:
      // const provider = window?.solana;
      // if (!provider?.isPhantom) throw new Error("Phantom not installed");
      // const resp = await provider.connect();
      // const address = resp.publicKey.toString();
      // then fetch wallet_status from Supabase by address

      await new Promise(r => setTimeout(r, 1200)); // simulate delay
      const mockAddress = "7xKX...d9Nf"; // replace with real address
      setWallet({
        ...mockWalletData,
        wallet_address: mockAddress,
        staked_amount: 350,
        rewards_accrued: 12.5,
        tier_name: "Seed",
        tier_threshold: 100,
        reward_boost: 1.0,
        perks: ["Basic access", "Standard rewards"],
        next_tier_name: "Growth",
        next_tier_threshold: 500,
      });
      setConnected(true);
      showToast("Wallet connected");
    } catch (err) {
      showToast("Connection failed — is Phantom installed?", "error");
    } finally {
      setConnecting(false);
    }
  }, []);

  const handleStake = useCallback(async (amount) => {
    setStaking(true);
    try {
      // Real implementation:
      // 1. Call Solana program to stake `amount` D9 tokens
      // 2. Get tx signature
      // 3. Call Supabase sync_wallet_stake() with tx signature
      // 4. Refresh wallet state from wallet_status view

      await new Promise(r => setTimeout(r, 1500));
      const newStaked = wallet.staked_amount + amount;
      const newTier = TIERS.slice().reverse().find(t => newStaked >= t.threshold);
      const nextTier = TIERS.find(t => t.threshold > newStaked);

      setWallet(w => ({
        ...w,
        staked_amount: newStaked,
        tier_name: newTier?.name || null,
        tier_threshold: newTier?.threshold || 0,
        reward_boost: newTier?.boost || 1.0,
        perks: newTier?.perks || [],
        next_tier_name: nextTier?.name || null,
        next_tier_threshold: nextTier?.threshold || null,
      }));
      showToast(`Staked ${formatD9(amount)} D9 successfully`);
    } catch (err) {
      showToast("Stake failed — try again", "error");
    } finally {
      setStaking(false);
    }
  }, [wallet]);

  const handleUnstake = useCallback(async (amount) => {
    if (amount > wallet.staked_amount) {
      showToast("Not enough staked D9", "error");
      return;
    }
    setStaking(true);
    try {
      await new Promise(r => setTimeout(r, 1500));
      const newStaked = Math.max(0, wallet.staked_amount - amount);
      const newTier = TIERS.slice().reverse().find(t => newStaked >= t.threshold);
      const nextTier = TIERS.find(t => t.threshold > newStaked);

      setWallet(w => ({
        ...w,
        staked_amount: newStaked,
        tier_name: newTier?.name || null,
        tier_threshold: newTier?.threshold || 0,
        reward_boost: newTier?.boost || 1.0,
        perks: newTier?.perks || [],
        next_tier_name: nextTier?.name || null,
        next_tier_threshold: nextTier?.threshold || null,
      }));
      showToast(`Unstaked ${formatD9(amount)} D9`);
    } catch (err) {
      showToast("Unstake failed — try again", "error");
    } finally {
      setStaking(false);
    }
  }, [wallet]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #070712; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>

      <div style={{
        background: "#070712",
        color: "#e8e8ff",
        fontFamily: "'Inter', sans-serif",
        minHeight: "100vh",
        padding: "0",
      }}>

        {/* Header */}
        <div style={{
          borderBottom: "1px solid #1e1e3a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "18px 32px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              background: "linear-gradient(135deg, #9945FF, #14F195)",
              borderRadius: "8px",
              height: "28px",
              width: "28px",
            }} />
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", letterSpacing: "-0.01em" }}>
              4DNFT <span style={{ color: "#9945FF" }}>/ D9</span>
            </span>
          </div>
          {connected && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <TierBadge name={wallet.tier_name} />
              <span style={{ color: "#6b6b8a", fontSize: "13px", fontFamily: "monospace" }}>
                {wallet.wallet_address}
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "40px 24px" }}>

          {!connected ? (
            /* ── Connect screen ── */
            <div style={{ textAlign: "center", padding: "80px 20px" }}>
              <div style={{
                background: "linear-gradient(135deg, #9945FF44, #14F19522)",
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: "80px",
                marginBottom: "28px",
                width: "80px",
              }}>
                <div style={{ fontSize: "36px" }}>◎</div>
              </div>
              <h1 style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "clamp(28px, 5vw, 42px)",
                fontWeight: "700",
                letterSpacing: "-0.02em",
                lineHeight: 1.15,
                marginBottom: "14px",
              }}>
                Stake D9.<br />
                <span style={{ background: "linear-gradient(90deg, #9945FF, #14F195)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  Unlock everything.
                </span>
              </h1>
              <p style={{ color: "#6b6b8a", fontSize: "16px", lineHeight: 1.6, marginBottom: "36px", maxWidth: "420px", margin: "0 auto 36px" }}>
                Connect your Phantom wallet to stake D9 tokens, earn boosted rewards, and upgrade your 4DNFT services.
              </p>
              <ConnectButton onConnect={connectWallet} connecting={connecting} />

              {/* Tier preview */}
              <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "48px", flexWrap: "wrap" }}>
                {TIERS.map(t => (
                  <div key={t.name} style={{
                    background: "#0f0f1a",
                    border: `1px solid ${t.color}33`,
                    borderRadius: "10px",
                    padding: "12px 18px",
                    textAlign: "left",
                    minWidth: "120px",
                  }}>
                    <div style={{ color: t.color, fontSize: "13px", fontWeight: "700" }}>{t.name}</div>
                    <div style={{ color: "#4b4b6a", fontSize: "12px", marginTop: "4px" }}>{formatD9(t.threshold)} D9</div>
                    <div style={{ color: "#6b6b8a", fontSize: "11px", marginTop: "2px" }}>{t.boost}x rewards</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── Dashboard ── */
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Stats row */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <StatCard label="Staked" value={`${formatD9(wallet.staked_amount)} D9`} sub="currently locked" />
                <StatCard label="Rewards" value={`${formatD9(wallet.rewards_accrued)} D9`} sub={`${wallet.reward_boost}x boost active`} />
                <StatCard label="Claimed" value={`${formatD9(wallet.rewards_claimed)} D9`} sub="lifetime total" />
              </div>

              {/* Tier progress */}
              <TierProgress wallet={wallet} />

              {/* Upgrade box */}
              <UpgradeBox
                wallet={wallet}
                onStake={handleStake}
                onUnstake={handleUnstake}
                staking={staking}
              />

              {/* Tier grid */}
              <TierGrid activeTier={wallet.tier_name} />

            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            background: toast.type === "error" ? "#2a0f1a" : "#0f2a1a",
            border: `1px solid ${toast.type === "error" ? "#ff4444" : "#14F195"}44`,
            borderRadius: "10px",
            bottom: "24px",
            color: toast.type === "error" ? "#ff8888" : "#14F195",
            fontSize: "14px",
            fontWeight: "500",
            padding: "12px 20px",
            position: "fixed",
            right: "24px",
            zIndex: 999,
          }}>
            {toast.msg}
          </div>
        )}
      </div>
    </>
  );
}
