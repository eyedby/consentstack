const express = require('express');
const path = require('path');
const helmet = require('helmet');
// Cryptographic verification engine module integration
const { verifyAndGenerateProof } = require('./amok-verify.js'); 

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser for processing cryptographic proof submissions
app.use(express.json());

// 1. Strict Security Headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      connectSrc: [
        "'self'", 
        "https://api.github.com", 
        "https://api.mainnet-beta.solana.com", 
        "https://api.devnet.solana.com"
      ],
      imgSrc: ["'self'", "data:", "https:*"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// 2. Regional Access Control
app.use((req, res, next) => {
  const country = req.headers['cf-ipcountry'];
  if (country && !['US', 'CA', 'MX'].includes(country)) {
    return res.status(403).send('Access denied: Regional network restriction active.');
  }
  next();
});

// 3. Static Assets & Sub-App Resource Mapping
app.use(express.static(path.join(__dirname))); 
app.use('/assets', express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// 4. Clean Page Route Mappings
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/free-vote', (req, res) => res.sendFile(path.join(__dirname, 'poem.html')));
app.get('/forge', (req, res) => res.sendFile(path.join(__dirname, 'about.html')));
app.get('/whitepaper', (req, res) => res.sendFile(path.join(__dirname, 'whitepaper.html')));
app.get('/issues', (req, res) => res.sendFile(path.join(__dirname, 'issues.html')));

// 5. Consensus & Consent Stack Infrastructure APIs
app.post('/api/proofs/register', async (req, res) => {
  const { githubUsername, passphrase } = req.body;
  
  // Extract real client IP (prioritizing cloud edge headers over standard express fallbacks)
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;

  try {
    // This executes your 18-month check, 24h IP window, and zero-knowledge identity swap
    const proof = await verifyAndGenerateProof(githubUsername, passphrase, clientIP);
    
    console.log(`[Consent Stack] Appended anonymous commitment: ${proof.commitment.slice(0, 8)}...`);
    
    return res.status(201).json({ 
      success: true, 
      proof
    });
  } catch (err) {
    // If rate limits or age checks fail, return the error to poem.html seamlessly
    return res.status(400).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// 6. Native Fallbacks for Decentralized Apps & Dashboards
app.get('/dashboard/*splatsplat', (req, res) => res.sendFile(path.join(__dirname, 'dashboard', 'index.html')));
app.get('/amok/*splatsplatsplat', (req, res) => res.sendFile(path.join(__dirname, 'amok', 'index.html')));
app.get('/4dnft/*splat', (req, res) => res.sendFile(path.join(__dirname, '4dnft', 'index.html')));

// Root wildcard catch-all fallback
app.get('*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Consent Stack] Infrastructure active on port ${PORT}`);
});
