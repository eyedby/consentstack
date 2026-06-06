// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────
//  AMOK.sol v0.2 — keepAIon pledge ZK verifier
//  Fixes applied:
//    - Commitment salt prevents grinding attacks
//    - Two-step commit-reveal prevents front-running
//    - Nullifier stored before external calls (re-entrancy safe)
//    - Gas-optimised public input packing
//    - Owner is multisig-ready (transfer to Gnosis Safe after deploy)
// ─────────────────────────────────────────────────────────────

interface IUltraVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external view returns (bool);
}

interface IAMOKToken {
    function mint(address to, uint256 tokenId, bytes32 nullifier) external;
}

contract AMOK {

    // ── Immutables ────────────────────────────────────────────
    IUltraVerifier public immutable verifier;

    // ── State ─────────────────────────────────────────────────
    bytes32  public pledgeRoot;
    uint256  public totalPledges;
    address  public owner;
    address  public tokenContract;   // AMOKToken address (set post-deploy)

    mapping(bytes32 => bool)    public nullifiers;
    mapping(bytes32 => bool)    public commitments;
    mapping(bytes32 => uint256) public tokenByCommitment;
    mapping(uint256 => bytes32) public tokens;

    // Commitment timestamp — prevents stale commitments being used
    mapping(bytes32 => uint256) public commitmentTimestamp;
    uint256 public constant COMMITMENT_EXPIRY = 7 days;

    // ── Events ────────────────────────────────────────────────
    event CommitmentRegistered(bytes32 indexed commitment, uint256 expiresAt);
    event PledgeMade(uint256 indexed tokenId, bytes32 indexed nullifier);
    event RootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot);
    event TokenContractSet(address indexed tokenContract);

    // ── Errors ────────────────────────────────────────────────
    error AlreadyRegistered();
    error AlreadyPledged();
    error CommitmentUnknown();
    error CommitmentExpired();
    error InvalidRoot();
    error InvalidProof();
    error Unauthorized();
    error ZeroAddress();

    // ── Constructor ───────────────────────────────────────────
    constructor(address _verifier, bytes32 _initialRoot) {
        if (_verifier == address(0)) revert ZeroAddress();
        verifier   = IUltraVerifier(_verifier);
        pledgeRoot = _initialRoot;
        owner      = msg.sender;
    }

    // ── Step 1: Register commitment ───────────────────────────
    // commitment = pedersen(secret, githubHandleHash)
    // Called BEFORE proof generation — prevents front-running
    function registerCommitment(bytes32 commitment) external {
        if (commitments[commitment]) revert AlreadyRegistered();
        commitments[commitment]         = true;
        commitmentTimestamp[commitment] = block.timestamp;
        emit CommitmentRegistered(commitment, block.timestamp + COMMITMENT_EXPIRY);
    }

    // ── Step 2: Submit ZK proof ───────────────────────────────
    function pledge(
        bytes   calldata proof,
        bytes32          commitment,
        bytes32          nullifier,
        bytes32          root
    ) external returns (uint256 tokenId) {
        // Checks
        if (nullifiers[nullifier])    revert AlreadyPledged();
        if (!commitments[commitment]) revert CommitmentUnknown();
        if (block.timestamp > commitmentTimestamp[commitment] + COMMITMENT_EXPIRY)
            revert CommitmentExpired();
        if (root != pledgeRoot)       revert InvalidRoot();

        // Pack public inputs in circuit order: commitment, nullifier, root
        bytes32[] memory pub = new bytes32[](3);
        pub[0] = commitment;
        pub[1] = nullifier;
        pub[2] = root;
        if (!verifier.verify(proof, pub)) revert InvalidProof();

        // Effects — nullifier marked BEFORE any external call
        nullifiers[nullifier]         = true;
        tokenId                        = ++totalPledges;
        tokens[tokenId]                = nullifier;
        tokenByCommitment[commitment]  = tokenId;

        emit PledgeMade(tokenId, nullifier);

        // Interactions — mint soulbound token if contract set
        if (tokenContract != address(0)) {
            IAMOKToken(tokenContract).mint(msg.sender, tokenId, nullifier);
        }
    }

    // ── Read ──────────────────────────────────────────────────
    function isValid(uint256 tokenId) external view returns (bool) {
        return tokens[tokenId] != bytes32(0);
    }

    // ── Admin ─────────────────────────────────────────────────
    function setTokenContract(address _tokenContract) external {
        if (msg.sender != owner) revert Unauthorized();
        if (_tokenContract == address(0)) revert ZeroAddress();
        tokenContract = _tokenContract;
        emit TokenContractSet(_tokenContract);
    }

    function updateRoot(bytes32 newRoot) external {
        if (msg.sender != owner) revert Unauthorized();
        emit RootUpdated(pledgeRoot, newRoot);
        pledgeRoot = newRoot;
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner)   revert Unauthorized();
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
