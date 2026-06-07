// AMOK pledge circuit — keepAIon-pledge-v1
// Noir >= 0.30
// Proves: developer signed the keepAIon pledge
// Conceals: who they are
//
// eyedby/keepaion

use dep::std::hash::pedersen_hash;
use dep::std::merkle::compute_merkle_root;

// TREE_DEPTH must match merkle.ts TREE_DEPTH constant
global TREE_DEPTH: u32 = 20;

fn main(
    // ── Private inputs ────────────────────────────────────────
    secret:             Field,
    github_handle_hash: Field,
    path_indices:       [u1; 20],
    hash_path:          [Field; 20],

    // ── Public inputs ─────────────────────────────────────────
    commitment:  pub Field,
    nullifier:   pub Field,
    pledge_root: pub Field,
) {
    // 1. Commitment integrity
    //    commitment = pedersen(secret, github_handle_hash)
    let computed_commitment = pedersen_hash([secret, github_handle_hash]);
    assert(computed_commitment == commitment);

    // 2. Nullifier integrity — prevents double-pledge
    //    nullifier = pedersen(secret, 0)
    let computed_nullifier = pedersen_hash([secret, 0]);
    assert(computed_nullifier == nullifier);

    // 3. Merkle membership — proves commitment is in the pledge tree
    let computed_root = compute_merkle_root(commitment, path_indices, hash_path);
    assert(computed_root == pledge_root);
}

// ── Unit tests ────────────────────────────────────────────────
#[test]
fn test_valid_proof() {
    let secret             = 42;
    let github_handle_hash = 99;
    let commitment         = dep::std::hash::pedersen_hash([secret, github_handle_hash]);
    let nullifier          = dep::std::hash::pedersen_hash([secret, 0]);
    let path_indices: [u1; 20]    = [0; 20];
    let hash_path:   [Field; 20] = [0; 20];
    let pledge_root = dep::std::merkle::compute_merkle_root(
        commitment, path_indices, hash_path
    );
    main(secret, github_handle_hash, path_indices, hash_path,
         commitment, nullifier, pledge_root);
}

#[test(should_fail_with = "")]
fn test_wrong_secret_rejected() {
    let secret             = 42;
    let wrong_secret       = 43;
    let github_handle_hash = 99;
    let commitment         = dep::std::hash::pedersen_hash([secret, github_handle_hash]);
    let nullifier          = dep::std::hash::pedersen_hash([wrong_secret, 0]);
    let path_indices: [u1; 20]    = [0; 20];
    let hash_path:   [Field; 20] = [0; 20];
    let pledge_root = dep::std::merkle::compute_merkle_root(
        commitment, path_indices, hash_path
    );
    // Should fail — nullifier derived from wrong secret
    main(wrong_secret, github_handle_hash, path_indices, hash_path,
         commitment, nullifier, pledge_root);
}

#[test(should_fail_with = "")]
fn test_wrong_commitment_rejected() {
    let secret             = 42;
    let github_handle_hash = 99;
    let fake_commitment    = 12345;
    let nullifier          = dep::std::hash::pedersen_hash([secret, 0]);
    let path_indices: [u1; 20]    = [0; 20];
    let hash_path:   [Field; 20] = [0; 20];
    let pledge_root = dep::std::merkle::compute_merkle_root(
        fake_commitment, path_indices, hash_path
    );
    // Should fail — commitment doesn't match secret + handle
    main(secret, github_handle_hash, path_indices, hash_path,
         fake_commitment, nullifier, pledge_root);
}
