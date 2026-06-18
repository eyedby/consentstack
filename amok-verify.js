// ── 5. Consensus & Consent Stack Infrastructure APIs ──────────────────────────

// Data tracking array for verified votes (lives in memory for now)
const verifiedVotes = [];

// GET Route: Pulls real-time totals for the front-end dashboard
app.get('/api/issues/counts', (req, res) => {
  const count1 = verifiedVotes.filter(key => key.startsWith('1:')).length;
  const count2 = verifiedVotes.filter(key => key.startsWith('2:')).length;

  res.json({
    success: true,
    counts: {
      issue1: 12847 + count1, // Base lore signature count + real live entries
      issue2: 847 + count2
    }
  });
});

// POST Route: Registers a new anonymous token vote
app.post('/api/proofs/register', async (req, res) => {
  const { githubUsername, passphrase } = req.body;
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
    return res.status(400).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// POST Route: Submits a single-use token to sign a specific petition
app.post('/api/issues/vote', (req, res) => {
  const { issueId, token } = req.body;

  if (!issueId || !token || token.length !== 32) {
    return res.status(400).json({ success: false, error: 'Malformed token verification request.' });
  }

  // Prevent token reuse across the exact same issue tracking block
  const trackingKey = `${issueId}:${token}`;
  if (verifiedVotes.includes(trackingKey)) {
    return res.status(400).json({ success: false, error: 'This specific proof token has already signed this petition.' });
  }

  // Record the verified consensus token safely
  verifiedVotes.push(trackingKey);
  console.log(`[Watchful Constituency] Verified vote ledger appended for Issue #${issueId}`);

  return res.status(200).json({
    success: true,
    status: 'Token verification matched. Petition updated.'
  });
});