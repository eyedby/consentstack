/**
 * Solana SPL Token Balance Checker — The Consent Stack
 */
const TokenGate = {
  // Uses standard window.fetch to interrogate the Solana RPC endpoint without heavy libraries
  getSPLTokenBalance: async function(walletAddress, mintAddress, rpcEndpoint) {
    try {
      console.log(`[TokenGate] Querying account tracking for wallet: ${walletAddress}`);
      
      // 1. Construct the standard JSON-RPC payload for 'getTokenAccountsByOwner'
      const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          { mint: mintAddress },
          { encoding: "jsonParsed" }
        ]
      };

      // 2. Dispatch request directly to the decentralized ledger interface
      const response = await fetch(rpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      
      // 3. Parse out the token account structures
      const accounts = data.result?.value;
      if (!accounts || accounts.length === 0) {
        console.log("[TokenGate] No token account found for this mint address.");
        return 0; // Holder balance is zero
      }

      // 4. Extract UI-ready decimal balance from the first matching token account
      const tokenAmount = accounts[0].account.data.parsed.info.tokenAmount.uiAmount;
      console.log(`[TokenGate] Active balance verified: ${tokenAmount} Δ9`);
      return tokenAmount;

    } catch (error) {
      console.error("[TokenGate] Critical RPC layout parsing failed:", error);
      return 0;
    }
  }
};
