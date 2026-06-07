import { ethers }    from "ethers";
import { MerkleTree } from "merkletreejs";
import * as fs        from "fs";

// ─────────────────────────────────────────────────────────────
//  merkle.ts — off-chain Merkle tree for AMOK commitments
//
//  TREE_DEPTH must match the circuit constant in main.nr
//  Commands:
//    npx ts-node scripts/merkle.ts add   <0xcommitment>
//    npx ts-node scripts/merkle.ts root
//    npx ts-node scripts/merkle.ts proof <0xcommitment>
//    npx ts-node scripts/merkle.ts list
// ─────────────────────────────────────────────────────────────

export const TREE_DEPTH = 20; // must match circuit global TREE_DEPTH
const TREE_FILE = "./merkle-state.json";

function hashFn(data: Buffer): Buffer {
    return Buffer.from(ethers.keccak256(data).slice(2), "hex");
}

interface State { leaves: string[]; root: string; updatedAt: number; }

function loadState(): State {
    if (!fs.existsSync(TREE_FILE)) return { leaves: [], root: ethers.ZeroHash, updatedAt: 0 };
    return JSON.parse(fs.readFileSync(TREE_FILE, "utf8"));
}

function buildTree(leaves: string[]): MerkleTree {
    const bufs = leaves.map(l => Buffer.from(l.replace("0x",""), "hex"));
    return new MerkleTree(bufs, hashFn, { sortPairs: true });
}

function saveState(leaves: string[], root: string) {
    fs.writeFileSync(TREE_FILE, JSON.stringify({ leaves, root, updatedAt: Date.now() }, null, 2));
}

// ── Add commitment ────────────────────────────────────────────
export function addCommitment(commitment: string): string {
    const state = loadState();
    if (state.leaves.includes(commitment)) throw new Error("Already in tree");
    state.leaves.push(commitment);
    const tree = buildTree(state.leaves);
    const root = tree.getHexRoot();
    saveState(state.leaves, root);
    console.log(`✓ Added:    ${commitment}`);
    console.log(`  New root: ${root}`);
    console.log(`\n  Push new root on-chain:`);
    console.log(`  npx hardhat run scripts/update-root.ts --network base-sepolia`);
    return root;
}

// ── Get merkle proof (for frontend/circuit) ───────────────────
export function getMerkleProof(commitment: string): {
    pathIndices: number[];
    hashPath:    string[];
    root:        string;
} {
    const state = loadState();
    if (!state.leaves.includes(commitment)) throw new Error("Commitment not in tree");
    const tree  = buildTree(state.leaves);
    const leaf  = Buffer.from(commitment.replace("0x",""), "hex");
    const proof = tree.getProof(leaf);

    // Pad to TREE_DEPTH (circuit expects fixed-length arrays)
    const pathIndices: number[] = [];
    const hashPath:    string[] = [];
    for (let i = 0; i < TREE_DEPTH; i++) {
        if (i < proof.length) {
            pathIndices.push(proof[i].position === "right" ? 1 : 0);
            hashPath.push("0x" + proof[i].data.toString("hex").padStart(64, "0"));
        } else {
            pathIndices.push(0);
            hashPath.push(ethers.ZeroHash);
        }
    }
    return { pathIndices, hashPath, root: tree.getHexRoot() };
}

// ── Get current root ──────────────────────────────────────────
export function getRoot(): string {
    const state = loadState();
    console.log(`Root:    ${state.root}`);
    console.log(`Leaves:  ${state.leaves.length}`);
    console.log(`Updated: ${new Date(state.updatedAt).toISOString()}`);
    return state.root;
}

// ── List all commitments ──────────────────────────────────────
export function listCommitments(): string[] {
    const state = loadState();
    state.leaves.forEach((l, i) => console.log(`  ${i+1}. ${l}`));
    return state.leaves;
}

// ── CLI ───────────────────────────────────────────────────────
const [,, cmd, arg] = process.argv;
if      (cmd === "add"   && arg) addCommitment(arg);
else if (cmd === "root")         getRoot();
else if (cmd === "proof" && arg) console.log(JSON.stringify(getMerkleProof(arg), null, 2));
else if (cmd === "list")         listCommitments();
else {
    console.log("Usage:");
    console.log("  npx ts-node scripts/merkle.ts add   <0xcommitment>");
    console.log("  npx ts-node scripts/merkle.ts root");
    console.log("  npx ts-node scripts/merkle.ts proof <0xcommitment>");
    console.log("  npx ts-node scripts/merkle.ts list");
}
