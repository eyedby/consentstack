[README.md](https://github.com/user-attachments/files/28669850/README.md)
# The Consent Stack
**eyedby/consentstack · v0.1**

> *building by builders · we thought this through*

[![keepAIon](https://keepaion.com/badge.svg)](https://keepaion.com)

The Consent Stack is a five-layer protocol ecosystem for consent-first participation in AI, web3, and digital media. Each layer is independently useful. Together they form the first complete infrastructure for AI rights, builder credentialing, zero-knowledge identity, utility economics, and creative provenance.

---

## The five layers

| Layer | Domain | What it does |
|---|---|---|
| **Rights** | [aiOut.me](https://aiout.me) | Public opt-out registry and legal record for AI consent |
| **Builders** | [keepAIon.com](https://keepaion.com) | Developer pledge and ethical AI credential |
| **Proof** | AMOK | Zero-knowledge proof — proves pledge without revealing identity |
| **Economy** | [Δ9.com](https://delta9.com) | Solana SPL utility token — gates AMOK, governs ecosystem |
| **Media** | [4DNFT.com](https://4dnft.com) | On-chain artist play and share tracking NFT |

---

## Repo structure

```
eyedby/consentstack/
├── site/                        ← Unified frontend (all five domains)
│   ├── index.html               ← Domain-aware landing page
│   └── whitepaper.html          ← The Consent Stack white paper
│
├── amok/                        ← AMOK ZKP credential system
│   ├── circuits/
│   │   └── amok_pledge/
│   │       ├── src/main.nr      ← Noir ZK circuit
│   │       └── Nargo.toml
│   ├── contracts/
│   │   ├── AMOK.sol             ← Pledge verifier + soulbound token
│   │   ├── AMOKToken.sol        ← ERC-721 soulbound
│   │   ├── mock/MockVerifier.sol
│   │   └── test/AMOK.test.ts
│   ├── scripts/
│   │   ├── deploy.ts
│   │   ├── merkle.ts
│   │   └── update-root.ts
│   ├── hardhat.config.ts
│   └── .env.example
│
├── delta9/                      ← Δ9 SPL token (Solana)
│   └── src/                     ← Anchor program — Phase 2
│
├── 4dnft/                       ← 4DNFT play/share tracking
│   ├── contracts/
│   │   └── FourDNFT.sol         ← ERC-1155 + ERC-2981 + play/share
│   └── test/
│
├── docs/
│   └── WHITEPAPER.md            ← The Consent Stack white paper (source)
│
├── .github/
│   └── workflows/
│       └── deploy.yml           ← Auto-deploy to GoDaddy on push to main
│
├── .cpanel.yml                  ← cPanel Git deploy config
├── .env.example                 ← Copy to .env, never commit
├── .gitignore
└── README.md
```

---

## Quick start

```bash
git clone https://github.com/eyedby/consentstack
cd consentstack
```

### Site (deploy to GoDaddy)
```bash
# Upload site/index.html and site/whitepaper.html to public_html/
# Or push to main — GitHub Actions auto-deploys via SSH
```

### AMOK contracts
```bash
cd amok
cp .env.example .env        # fill in PRIVATE_KEY etc.
npm install
npm run circuit:build       # compile Noir circuit
npm run circuit:test        # run ZK circuit tests
npm run test                # run contract tests
npm run deploy:testnet      # deploy to Base Sepolia
```

### 4DNFT contract
```bash
cd 4dnft
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network base-sepolia
```

---

## Roadmap

| Phase | Timeline | Milestone |
|---|---|---|
| **0 — Foundation** | Now | Repo clean · white paper v0.2 · branding locked |
| **1 — MVP** | 4–8 weeks | Pledge page · AMOK browser demo · opt-out registry · 4DNFT static |
| **2 — On-chain** | Q3 2026 | AMOK on Base Sepolia · Δ9 on Solana devnet |
| **3 — 4DNFT** | Q4 2026 | Artist minting · play/share recording · royalties |
| **4 — Economy** | Q1 2027 | Δ9 mainnet · AMOK subscription · cross-chain oracle |
| **5 — Scale** | 2027 | Legal filings · developer directory · streaming integrations |

---

## Domains

All five domains are masked to **aiOut.me** and served from one `site/index.html`. The page detects `window.location.hostname` and renders the appropriate theme.

| Domain | Theme | Colour |
|---|---|---|
| aiout.me | Rights movement | Red `#D85A30` |
| keepaion.com | Builder pledge | Green `#1D9E75` |
| delta9.com | Utility token | Gold `#B8860B` |
| 4dnft.com | Artist NFTs | Purple `#8B5CF6` |

---

## White paper

[The Consent Stack — White Paper v0.1](docs/WHITEPAPER.md)

---

## Contact

- **X:** [@keepaion](https://x.com/keepaion)
- **GitHub:** [eyedby/consentstack](https://github.com/eyedby/consentstack)
- **aiOut:** [aiout.me](https://aiout.me)
- **keepAIon:** [keepaion.com](https://keepaion.com)

---

*The Consent Stack · eyedby/consentstack · building by builders*
