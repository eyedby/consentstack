import { ethers, network, run } from "hardhat";
import { MerkleTree }           from "merkletreejs";
import * as dotenv              from "dotenv";
import * as fs                  from "fs";
dotenv.config();

// ─────────────────────────────────────────────────────────────
//  deploy.ts — AMOK deployment
//
//  Testnet: npx hardhat run scripts/deploy.ts --network base-sepolia
//  Mainnet: npx hardhat run scripts/deploy.ts --network base
//
//  ⚠️  UltraVerifier is large (~24KB bytecode).
//      EVM bytecode limit is 24576 bytes (EIP-170).
//      Strategy: deploy verifier FIRST via separate tx, check size.
//      If it fails, use a proxy/split verifier pattern.
// ─────────────────────────────────────────────────────────────

async function estimateSize(bytecode: string): Promise<number> {
    return (bytecode.length - 2) / 2; // hex string → bytes
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const balance    = await ethers.provider.getBalance(deployer.address);

    console.log("\n🌿 AMOK deployment");
    console.log(`   Network:  ${network.name}`);
    console.log(`   Deployer: ${deployer.address}`);
    console.log(`   Balance:  ${ethers.formatEther(balance)} ETH`);

    if (ethers.formatEther(balance) === "0.0") {
        console.error("\n❌ Deployer has no ETH. Fund it first.");
        process.exit(1);
    }

    // ── 1. Check if real UltraVerifier exists (from nargo codegen-verifier) ──
    let verifierAddress: string;
    const verifierPath = "./contracts/UltraVerifier.sol";
    const useReal      = fs.existsSync(verifierPath);

    if (useReal) {
        console.log("\n📦 Deploying UltraVerifier (from Noir codegen)...");
        const VF       = await ethers.getContractFactory("UltraVerifier");
        const bytecode = VF.bytecode;
        const size     = await estimateSize(bytecode);
        console.log(`   Bytecode size: ${size} bytes (limit: 24576)`);
        if (size > 24576) {
            console.warn("   ⚠️  Verifier exceeds EIP-170 limit — deploy will fail on mainnet.");
            console.warn("   Fix: use viaIR + optimizer runs=1, or proxy pattern.");
            if (network.name === "base") { process.exit(1); }
        }
        const verifier = await VF.deploy();
        await verifier.waitForDeployment();
        verifierAddress = await verifier.getAddress();
    } else {
        console.log("\n⚠️  UltraVerifier.sol not found — using MockVerifier.");
        console.log("   Run: cd circuits/amok_pledge && nargo codegen-verifier");
        console.log("   Then copy generated verifier to contracts/UltraVerifier.sol\n");
        const VF       = await ethers.getContractFactory("MockVerifier");
        const verifier = await VF.deploy();
        await verifier.waitForDeployment();
        verifierAddress = await verifier.getAddress();
    }
    console.log(`   ✓ Verifier: ${verifierAddress}`);

    // ── 2. Build initial Merkle tree ──────────────────────────
    const tree        = new MerkleTree([], (x: Buffer) => Buffer.from(ethers.keccak256(x).slice(2), "hex"), { sortPairs: true });
    const initialRoot = tree.getHexRoot() === "" ? ethers.ZeroHash : tree.getHexRoot();
    console.log(`\n   Merkle root: ${initialRoot}`);

    // ── 3. Deploy AMOK ────────────────────────────────────────
    console.log("\n📦 Deploying AMOK...");
    const AF   = await ethers.getContractFactory("AMOK");
    const amok = await AF.deploy(verifierAddress, initialRoot);
    await amok.waitForDeployment();
    const amokAddress = await amok.getAddress();
    console.log(`   ✓ AMOK: ${amokAddress}`);

    // ── 4. Deploy AMOKToken ───────────────────────────────────
    console.log("\n📦 Deploying AMOKToken...");
    const TF    = await ethers.getContractFactory("AMOKToken");
    const token = await TF.deploy(amokAddress);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log(`   ✓ AMOKToken: ${tokenAddress}`);

    // ── 5. Wire token contract into AMOK ──────────────────────
    console.log("\n🔗 Wiring contracts...");
    const tx = await amok.setTokenContract(tokenAddress);
    await tx.wait();
    console.log(`   ✓ AMOKToken set on AMOK`);

    // ── 6. Write deployment addresses ────────────────────────
    const deployment = {
        network:         network.name,
        deployedAt:      new Date().toISOString(),
        deployer:        deployer.address,
        verifier:        verifierAddress,
        amok:            amokAddress,
        amokToken:       tokenAddress,
        initialRoot,
        realVerifier:    useReal,
    };
    fs.writeFileSync(
        `./deployments/${network.name}.json`,
        JSON.stringify(deployment, null, 2)
    );

    // ── 7. Summary ────────────────────────────────────────────
    console.log("\n✅ Deployment complete");
    console.log("─────────────────────────────────────────────");
    console.log(`  Verifier  : ${verifierAddress}`);
    console.log(`  AMOK      : ${amokAddress}`);
    console.log(`  AMOKToken : ${tokenAddress}`);
    console.log(`  Root      : ${initialRoot}`);
    console.log(`  Network   : ${network.name}`);
    console.log("─────────────────────────────────────────────");

    // ── 8. Basescan verification ──────────────────────────────
    if (network.name !== "hardhat" && network.name !== "localhost" && process.env.BASESCAN_API_KEY) {
        console.log("\n🔍 Verifying on Basescan (wait 30s for propagation)...");
        await new Promise(r => setTimeout(r, 30_000));
        try {
            await run("verify:verify", { address: amokAddress, constructorArguments: [verifierAddress, initialRoot] });
            await run("verify:verify", { address: tokenAddress, constructorArguments: [amokAddress] });
            console.log("   ✓ Verified");
        } catch (e: any) {
            console.log("   ⚠️  Verification failed:", e.message);
        }
    } else {
        console.log(`\n  Verify manually:`);
        console.log(`  npx hardhat verify --network ${network.name} ${amokAddress} ${verifierAddress} ${initialRoot}`);
        console.log(`  npx hardhat verify --network ${network.name} ${tokenAddress} ${amokAddress}`);
    }

    console.log("\n  keepAIon.com · eyedby/keepaion · we thought this through\n");
}

// Ensure deployments dir exists
if (!fs.existsSync("./deployments")) fs.mkdirSync("./deployments");

main().catch(err => { console.error(err); process.exit(1); });
