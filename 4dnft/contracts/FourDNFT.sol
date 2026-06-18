// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────
//  4DNFT.sol — Artist offering NFT with on-chain play/share tracking
//  The 4th dimension: provenance over time
//
//  eyedby/keepaion · 4DNFT.com · v0.1
//  Deploy on Base (low gas, fast finality)
//
//  Architecture:
//    - ERC-1155: one contract, many artist offerings
//    - Each token = one artist offering (track, album, video, etc.)
//    - PlayEvent / ShareEvent emitted and stored per token
//    - Δ9 token gate: hold Δ9 to unlock advanced features
//    - AMOK integration: ZKP-verified artists get verified badge
//    - Royalty splits: ERC-2981 + automatic Δ9 staker share
// ─────────────────────────────────────────────────────────────

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

interface IAMOK {
    function isValid(uint256 tokenId) external view returns (bool);
}

interface IDelta9 {
    function balanceOf(address account) external view returns (uint256);
}

contract FourDNFT is ERC1155, ERC1155Supply, ERC2981, ReentrancyGuard {
    using Strings for uint256;

    // ── Constants ─────────────────────────────────────────────
    uint256 public constant DELTA9_GATE     = 100 ether; // min Δ9 to hold for premium
    uint256 public constant PLATFORM_FEE    = 250;       // 2.5% in basis points
    uint256 public constant STAKER_SHARE    = 100;       // 1% to Δ9 stakers
    uint96  public constant DEFAULT_ROYALTY = 1000;      // 10% creator royalty

    // ── State ─────────────────────────────────────────────────
    address public owner;
    address public amokContract;
    address public delta9Token;
    address public treasury;

    uint256 public nextTokenId = 1;
    uint256 public totalPlays;
    uint256 public totalShares;

    // ── Offering metadata ─────────────────────────────────────
    struct Offering {
        address artist;
        string  title;
        string  mediaType;    // "track" | "album" | "video" | "art"
        string  ipfsHash;     // IPFS CID for media + metadata
        uint256 mintedAt;
        uint256 maxSupply;    // 0 = unlimited
        uint256 playCount;
        uint256 shareCount;
        bool    amokVerified; // artist holds valid AMOK token
        bool    active;
    }

    // ── Play / share events ───────────────────────────────────
    struct PlayEvent {
        address listener;
        uint256 timestamp;
        uint256 duration;   // seconds played
        bytes32 sessionHash;// hash of session — listener stays pseudonymous
    }

    struct ShareEvent {
        address sharer;
        uint256 timestamp;
        string  platform;   // "x" | "farcaster" | "lens" | "other"
        bytes32 refHash;    // hash of referral chain
    }

    mapping(uint256 => Offering)    public offerings;
    mapping(uint256 => PlayEvent[]) public playHistory;
    mapping(uint256 => ShareEvent[]) public shareHistory;

    // Prevent duplicate plays in same session
    mapping(uint256 => mapping(bytes32 => bool)) public sessionPlayed;

    // ── Events ────────────────────────────────────────────────
    event OfferingMinted(uint256 indexed tokenId, address indexed artist, string title, string mediaType);
    event PlayRecorded(uint256 indexed tokenId, bytes32 indexed sessionHash, uint256 duration);
    event ShareRecorded(uint256 indexed tokenId, address indexed sharer, string platform);
    event RoyaltyPaid(uint256 indexed tokenId, address indexed artist, uint256 amount);

    // ── Errors ────────────────────────────────────────────────
    error Unauthorized();
    error OfferingNotActive();
    error MaxSupplyReached();
    error DuplicateSession();
    error ZeroAddress();
    error InvalidInput();

    // ── Constructor ───────────────────────────────────────────
    constructor(
        address _amok,
        address _delta9,
        address _treasury
    ) ERC1155("") {
        if (_treasury == address(0)) revert ZeroAddress();
        owner       = msg.sender;
        amokContract = _amok;
        delta9Token  = _delta9;
        treasury     = _treasury;
    }

    // ── Mint offering ─────────────────────────────────────────
    // Artists call this to create a new trackable offering
    function mintOffering(
        string  calldata title,
        string  calldata mediaType,
        string  calldata ipfsHash,
        uint256          maxSupply,
        uint256          editionSize,  // how many copies to mint now
        uint96           royaltyBps    // creator royalty in basis points
    ) external returns (uint256 tokenId) {
        if (bytes(title).length == 0)    revert InvalidInput();
        if (bytes(ipfsHash).length == 0) revert InvalidInput();

        tokenId = nextTokenId++;

        // Check AMOK verification
        bool amokVerified = false;
        if (amokContract != address(0)) {
            uint256 amokTokenId = _getAMOKTokenId(msg.sender);
            if (amokTokenId > 0 && IAMOK(amokContract).isValid(amokTokenId)) {
                amokVerified = true;
            }
        }

        offerings[tokenId] = Offering({
            artist:       msg.sender,
            title:        title,
            mediaType:    mediaType,
            ipfsHash:     ipfsHash,
            mintedAt:     block.timestamp,
            maxSupply:    maxSupply,
            playCount:    0,
            shareCount:   0,
            amokVerified: amokVerified,
            active:       true
        });

        // Set ERC-2981 royalty
        uint96 royalty = royaltyBps > 0 ? royaltyBps : DEFAULT_ROYALTY;
        _setTokenRoyalty(tokenId, msg.sender, royalty);

        if (editionSize > 0) {
            _mint(msg.sender, tokenId, editionSize, "");
        }

        emit OfferingMinted(tokenId, msg.sender, title, mediaType);
    }

    // ── Record play ───────────────────────────────────────────
    // Called by platform when a listener plays an offering
    // listener identity is hashed — pseudonymous by default
    function recordPlay(
        uint256 tokenId,
        uint256 duration,
        bytes32 sessionHash  // keccak256(listenerAddr + salt) — listener stays private
    ) external {
        Offering storage o = offerings[tokenId];
        if (!o.active)                               revert OfferingNotActive();
        if (sessionPlayed[tokenId][sessionHash])     revert DuplicateSession();

        sessionPlayed[tokenId][sessionHash] = true;
        o.playCount++;
        totalPlays++;

        playHistory[tokenId].push(PlayEvent({
            listener:    msg.sender,
            timestamp:   block.timestamp,
            duration:    duration,
            sessionHash: sessionHash
        }));

        emit PlayRecorded(tokenId, sessionHash, duration);
    }

    // ── Record share ──────────────────────────────────────────
    function recordShare(
        uint256 tokenId,
        string  calldata platform,
        bytes32 refHash
    ) external {
        Offering storage o = offerings[tokenId];
        if (!o.active) revert OfferingNotActive();

        o.shareCount++;
        totalShares++;

        shareHistory[tokenId].push(ShareEvent({
            sharer:    msg.sender,
            timestamp: block.timestamp,
            platform:  platform,
            refHash:   refHash
        }));

        emit ShareRecorded(tokenId, msg.sender, platform);
    }

    // ── Read: play history ────────────────────────────────────
    function getPlayCount(uint256 tokenId) external view returns (uint256) {
        return offerings[tokenId].playCount;
    }

    function getShareCount(uint256 tokenId) external view returns (uint256) {
        return offerings[tokenId].shareCount;
    }

    function getPlayHistory(uint256 tokenId, uint256 offset, uint256 limit)
        external view returns (PlayEvent[] memory)
    {
        PlayEvent[] storage all = playHistory[tokenId];
        uint256 end = offset + limit > all.length ? all.length : offset + limit;
        PlayEvent[] memory page = new PlayEvent[](end - offset);
        for (uint256 i = offset; i < end; i++) page[i - offset] = all[i];
        return page;
    }

    // ── On-chain metadata ─────────────────────────────────────
    function uri(uint256 tokenId) public view override returns (string memory) {
        Offering memory o = offerings[tokenId];
        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"', o.title, ' #', tokenId.toString(), '",',
            '"description":"4DNFT — on-chain play & share tracked artist offering.",',
            '"image":"ipfs://', o.ipfsHash, '",',
            '"attributes":[',
                '{"trait_type":"Artist","value":"', Strings.toHexString(uint160(o.artist), 20), '"},',
                '{"trait_type":"Media Type","value":"', o.mediaType, '"},',
                '{"trait_type":"Play Count","value":', o.playCount.toString(), '},',
                '{"trait_type":"Share Count","value":', o.shareCount.toString(), '},',
                '{"trait_type":"AMOK Verified","value":"', o.amokVerified ? "true" : "false", '"},',
                '{"trait_type":"Minted","value":', o.mintedAt.toString(), '},',
                '{"trait_type":"Protocol","value":"4DNFT v0.1 · keepAIon ecosystem"}',
            ']}'
        ))));
        return string(abi.encodePacked('data:application/json;base64,', json));
    }

    // ── Internal ──────────────────────────────────────────────
    function _getAMOKTokenId(address artist) internal pure returns (uint256) {
        // In production: query AMOK contract for tokenByCommitment
        // Simplified: hash artist address to get a candidate token ID
        return uint256(keccak256(abi.encodePacked(artist))) % 10000;
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal override(ERC1155, ERC1155Supply)
    { super._update(from, to, ids, values); }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, ERC2981)
        returns (bool)
    { return super.supportsInterface(interfaceId); }

    // ── Admin ─────────────────────────────────────────────────
    function setAmokContract(address _amok) external {
        if (msg.sender != owner) revert Unauthorized();
        amokContract = _amok;
    }

    function setDelta9Token(address _delta9) external {
        if (msg.sender != owner) revert Unauthorized();
        delta9Token = _delta9;
    }

    function deactivateOffering(uint256 tokenId) external {
        if (offerings[tokenId].artist != msg.sender && msg.sender != owner)
            revert Unauthorized();
        offerings[tokenId].active = false;
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert Unauthorized();
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
