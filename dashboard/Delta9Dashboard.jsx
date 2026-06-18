import { useState, useCallback } from "react";

const TIERS = [
  {
    name: "Signal", threshold: 100, boost: 1.0, color: "#888780",
    perks: ["AMOK credential active", "Standard rewards", "aiOut pledge badge"]
  },
  {
    name: "Verify", threshold: 500, boost: 1.25, color: "#7F77DD",
    perks: ["AMOK credential active", "1.25× rewards", "Governance voting", "Early 4DNFT access"]
  },
  {
    name: "Delta", threshold: 2000, boost: 2.0, color: "#1D9E75",
    perks: ["AMOK credential active", "2× rewards", "Full governance weight", "4DNFT analytics", "Priority minting"]
  },
  {
    name: "Consent", threshold: 10000, boost: 3.0, color: "#D85A30",
    perks: ["AMOK credential active", "3× rewards", "Max governance weight", "4DNFT royalty splits", "Exclusive drops", "DAO board seat"]
  }
];

const ALL_PERKS = [
  { key: "AMOK credential active", desc: "ZKP stays live on keepAIon" },
  { key: "Standard rewards", desc: "1× base Δ9 accrual" },
  { key: "1.25× rewards", desc: "Boosted Δ9 accrual" },
  { key: "2× rewards", desc: "Double Δ9 accrual" },
  { key: "3× rewards", desc: "Triple Δ9 accrual" },
  { key: "aiOut pledge badge", desc: "Public solidarity badge" },
  { key: "Governance voting", desc: "Vote on pledge versions" },
  { key: "Full governance weight", desc: "Vote on legal strategy + royalties" },
  { key: "Max governance weight", desc: "Full DAO voting power" },
  { key: "Early 4DNFT access", desc: "Priority artist registration" },
  { key: "4DNFT analytics", desc: "On-chain play + share data" },
  { key: "Priority minting", desc: "First in queue at Phase 3" },
  { key: "4DNFT royalty splits", desc: "Auto ERC-2981 routing" },
  { key: "Exclusive drops", desc: "Invitation-only artist drops" },
  { key: "DAO board seat", desc: "keepAIon governance board" },
];

function getTier(staked) {
  return [...TIERS].reverse().find(t => staked >= t.threshold) || null;
}
function getNextTier(staked) {
  return TIERS.find(t => t.threshold > staked) || null;
}
function fmt(n) {
  if (!n) return "0";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return parseFloat(n.toFixed(2)).toString();
}

const s = {
  root: { fontFamily: "'Inter', sans-serif", background: "#070712", minHeight: "100vh", color: "#e8e8ff", padding: "0" },
  header: { borderBottom: "1px solid #1a1a2e", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 28px", flexWrap: "wrap", gap: 8 },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  logoMark: { fontSize: 22, color: "#7F77DD", fontWeight: 500 },
  logoText: { fontSize: 15, fontWeight: 600, color: "#e8e8ff", letterSpacing: "-0.01em" },
  body: { maxWidth: 820, margin: "0 auto", padding: "36px 20px" },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: "1.5rem" },
  stat: { background: "#0f0f1a", border: "1px solid #1a1a2e", borderRadius: 12, padding: "16px 18px" },
  statLabel: { fontSize: 11, color: "#6b6b8a", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 600, color: "#e8e8ff" },
  statSub: { fontSize: 11, color: "#4b4b6a", marginTop: 3 },
  card: { background: "#0c0c1c", border: "1px solid #1a1a2e", borderRadius: 14, padding: "20px 22px", marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: "#a0a0c0", marginBottom: 14 },
  progressTrack: { background: "#1a1a2e", borderRadius: 4, height: 6, overflow: "hidden", margin: "8px 0" },
  badge: (color, bg) => ({ display: "inline-flex", alignItems: "center", gap: 4, background: bg, border: `1px solid ${color}44`, borderRadius: 6, color, fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", padding: "3px 9px", textTransform: "uppercase" }),
  tierCard: (active, color) => ({ background: active ? `${color}11` : "#0a0a18", border: `1px solid ${active ? color + "55" : "#1a1a2e"}`, borderRadius: 10, padding: "13px 14px", flex: 1, minWidth: 120 }),
  perk: (unlocked) => ({ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid #12122a" }),
  input: { background: "#070712", border: "1px solid #1a1a2e", borderRadius: 9, color: "#e8e8ff", flex: 1, fontFamily: "inherit", fontSize: 14, outline: "none", padding: "11px 14px" },
  btn: (variant) => ({
    background: variant === "primary" ? "#7F77DD" : "transparent",
    border: `1px solid ${variant === "primary" ? "#7F77DD" : "#2a2a4a"}`,
    borderRadius: 9, color: variant === "primary" ? "#fff" : "#a0a0c0",
    cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 13, padding: "11px 18px", whiteSpace: "nowrap"
  }),
};

export default function Delta9Dashboard() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [staked, setStaked] = useState(0);
  const [rewards, setRewards] = useState(0);
  const [amount, setAmount] = useState("");
  const [toast, setToast] = useState(null);

  const tier = getTier(staked);
  const nextTier = getNextTier(staked);
  const amokActive = staked >= 100;

  const progress = nextTier
    ? Math.min(100, Math.round(((staked - (tier?.threshold || 0)) / (nextTier.threshold - (tier?.threshold || 0))) * 100))
    : 100;

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const connect = useCallback(async () => {
    setConnecting(true);
    await new Promise(r => setTimeout(r, 1200));
    // Real: const resp = await window.solana.connect(); then fetch from Supabase wallet_status
    setStaked(350);
    setRewards(12.5);
    setConnected(true);
    setConnecting(false);
    showToast("Wallet connected — 350 Δ9 staked");
  }, []);

  const stake = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    // Real: call Anchor program → get tx sig → call Supabase sync_wallet_stake()
    setStaked(s => s + n);
    setAmount("");
    showToast(`Staked ${fmt(n)} Δ9`);
  };

  const unstake = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    if (n > staked) { showToast("Not enough staked", "err"); return; }
    setStaked(s => Math.max(0, s - n));
    setAmount("");
    showToast(`Unstaked ${fmt(n)} Δ9`);
  };

  return (
    <div style={s.root}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'); * { box-sizing: border-box; margin:0; padding:0; } input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}`}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          <span style={s.logoMark}>Δ9</span>
          <span style={s.logoText}>keepAIon <span style={{ color: "#4b4b6a", fontWeight: 400 }}>/ consent stack</span></span>
        </div>
        {connected && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {tier && <span style={s.badge(tier.color, tier.color + "18")}>{tier.name}</span>}
            <span style={s.badge(amokActive ? "#1D9E75" : "#6b6b8a", amokActive ? "#1D9E7518" : "#1a1a2e")}>
              AMOK {amokActive ? "active" : "inactive"}
            </span>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#4b4b6a" }}>7xKX…d9Nf</span>
          </div>
        )}
      </div>

      <div style={s.body}>
        {!connected ? (
          /* Connect screen */
          <div style={{ textAlign: "center", padding: "60px 16px" }}>
            <div style={{ fontSize: 60, color: "#7F77DD", marginBottom: 20, lineHeight: 1 }}>Δ</div>
            <h1 style={{ fontSize: "clamp(24px,4vw,36px)", fontWeight: 600, color: "#e8e8ff", letterSpacing: "-0.02em", marginBottom: 12 }}>
              Your consent.<br /><span style={{ color: "#7F77DD" }}>Your credential.</span>
            </h1>
            <p style={{ color: "#6b6b8a", fontSize: 15, lineHeight: 1.7, maxWidth: 380, margin: "0 auto 32px" }}>
              Stake Δ9 to keep your AMOK zero-knowledge proof active, vote on keepAIon governance, and unlock 4DNFT artist features.
            </p>
            <button onClick={connect} disabled={connecting} style={{ ...s.btn("primary"), padding: "13px 32px", fontSize: 15, opacity: connecting ? 0.7 : 1 }}>
              {connecting ? "Connecting…" : "Connect Phantom"}
            </button>

            <div style={{ marginTop: 40 }}>
              <div style={{ fontSize: 11, color: "#4b4b6a", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>Tiers</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {TIERS.map(t => (
                  <div key={t.name} style={s.tierCard(false, t.color)}>
                    <div style={{ color: t.color, fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ color: "#6b6b8a", fontSize: 11, marginTop: 3 }}>{fmt(t.threshold)} Δ9</div>
                    <div style={{ color: "#4b4b6a", fontSize: 11, marginTop: 2 }}>{t.boost}× rewards</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Dashboard */
          <div>
            {/* Stats */}
            <div style={s.statGrid}>
              <div style={s.stat}>
                <div style={s.statLabel}>Staked</div>
                <div style={s.statValue}>{fmt(staked)} Δ9</div>
                <div style={s.statSub}>locked on Solana</div>
              </div>
              <div style={s.stat}>
                <div style={s.statLabel}>Rewards</div>
                <div style={s.statValue}>{fmt(rewards)} Δ9</div>
                <div style={s.statSub}>{tier?.boost || 1}× boost active</div>
              </div>
              <div style={s.stat}>
                <div style={s.statLabel}>Vote weight</div>
                <div style={s.statValue}>{Math.floor(staked / 100)}</div>
                <div style={s.statSub}>governance power</div>
              </div>
              <div style={s.stat}>
                <div style={s.statLabel}>AMOK</div>
                <div style={{ ...s.statValue, color: amokActive ? "#1D9E75" : "#6b6b8a" }}>
                  {amokActive ? "Live" : "Off"}
                </div>
                <div style={s.statSub}>{amokActive ? "ZKP credential active" : "stake 100 Δ9 to activate"}</div>
              </div>
            </div>

            {/* Progress */}
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={s.cardTitle}>Tier progress</div>
                <span style={{ fontSize: 12, color: "#4b4b6a" }}>{progress}%</span>
              </div>
              <div style={s.progressTrack}>
                <div style={{ height: "100%", borderRadius: 4, width: `${progress}%`, background: tier?.color || "#7F77DD", transition: "width 0.5s ease" }} />
              </div>
              <div style={{ fontSize: 12, color: "#6b6b8a" }}>
                {nextTier
                  ? <>{fmt(nextTier.threshold - staked)} Δ9 more to reach <span style={{ color: nextTier.color }}>{nextTier.name}</span></>
                  : <span style={{ color: "#D85A30" }}>Maximum tier — Consent reached</span>
                }
              </div>
            </div>

            {/* Upgrade box */}
            <div style={s.card}>
              <div style={s.cardTitle}>Stake / unstake Δ9</div>
              {nextTier && (
                <div style={{ background: `${nextTier.color}0f`, border: `1px solid ${nextTier.color}2a`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ color: nextTier.color, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Upgrade to {nextTier.name} — {fmt(nextTier.threshold)} Δ9 min
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {nextTier.perks.map(p => (
                      <span key={p} style={{ background: "#0a0a18", borderRadius: 5, color: "#6b6b8a", fontSize: 11, padding: "3px 8px" }}>+ {p}</span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input type="number" min="0" placeholder="Amount of Δ9" value={amount} onChange={e => setAmount(e.target.value)} style={s.input} />
                <button onClick={stake} style={s.btn("primary")}>Stake</button>
                <button onClick={unstake} style={s.btn("ghost")}>Unstake</button>
              </div>
              <div style={{ fontSize: 12, color: "#4b4b6a" }}>
                Currently staked: <span style={{ color: "#a0a0c0" }}>{fmt(staked)} Δ9</span>
              </div>
            </div>

            {/* Perks */}
            <div style={s.card}>
              <div style={s.cardTitle}>Features unlocked</div>
              {ALL_PERKS.map((p, i) => {
                const unlocked = tier?.perks.includes(p.key);
                return (
                  <div key={p.key} style={{ ...s.perk(unlocked), borderBottom: i < ALL_PERKS.length - 1 ? "1px solid #0f0f1e" : "none" }}>
                    <span style={{ fontSize: 16, color: unlocked ? "#1D9E75" : "#2a2a3a", marginTop: 1 }}>{unlocked ? "✓" : "○"}</span>
                    <div>
                      <div style={{ fontSize: 13, color: unlocked ? "#e8e8ff" : "#3a3a5a", fontWeight: unlocked ? 500 : 400 }}>{p.key}</div>
                      <div style={{ fontSize: 11, color: "#4b4b6a", marginTop: 1 }}>{p.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tier grid */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: "#4b4b6a", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>All tiers</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {TIERS.map(t => (
                  <div key={t.name} style={s.tierCard(tier?.name === t.name, t.color)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ color: t.color, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                      {tier?.name === t.name && <span style={{ background: `${t.color}22`, borderRadius: 4, color: t.color, fontSize: 10, fontWeight: 700, padding: "2px 6px" }}>NOW</span>}
                    </div>
                    <div style={{ color: "#6b6b8a", fontSize: 11 }}>{fmt(t.threshold)} Δ9 min</div>
                    <div style={{ color: "#4b4b6a", fontSize: 11, marginTop: 2 }}>{t.boost}× rewards</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          background: toast.type === "err" ? "#1a0a0a" : "#0a1a0f",
          border: `1px solid ${toast.type === "err" ? "#ff444444" : "#1D9E7544"}`,
          borderRadius: 10, bottom: 20, color: toast.type === "err" ? "#ff8888" : "#1D9E75",
          fontSize: 13, fontWeight: 500, padding: "11px 18px", position: "fixed", right: 20, zIndex: 999
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
