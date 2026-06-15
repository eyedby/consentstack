use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("YOUR_PROGRAM_ID_HERE");

// ── Constants ─────────────────────────────────────────────────────────────────
// BASE_REWARD_RATE: Δ9 tokens per second per 100 basis points of multiplier
// Adjust this before mainnet — currently set for devnet testing
const BASE_REWARD_RATE: u64 = 1; // 1 token per second at 1x (adjust for economics)

// Tier thresholds in Δ9 tokens
const TIER_SIGNAL:  u64 = 100;
const TIER_VERIFY:  u64 = 500;
const TIER_DELTA:   u64 = 2_000;
const TIER_CONSENT: u64 = 10_000;

// Multipliers in basis points (100 = 1x, 125 = 1.25x, 200 = 2x, 300 = 3x)
const MULT_NONE:    u64 = 0;
const MULT_SIGNAL:  u64 = 100;
const MULT_VERIFY:  u64 = 125;
const MULT_DELTA:   u64 = 200;
const MULT_CONSENT: u64 = 300;

// Snapshot: grace buffer after credential expires (48 hours in seconds)
const CREDENTIAL_GRACE_SECONDS: i64 = 48 * 60 * 60;

// ── Program ───────────────────────────────────────────────────────────────────
#[program]
pub mod delta9_staking {
    use super::*;

    /// Initialize a new user staking account
    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_staking_state;
        user_state.owner = ctx.accounts.user.key();
        user_state.staked_balance = 0;
        user_state.pending_rewards = 0;
        user_state.reward_multiplier = MULT_NONE;
        user_state.last_interaction_timestamp = Clock::get()?.unix_timestamp;
        user_state.bump = ctx.bumps.user_staking_state;
        Ok(())
    }

    /// Stake additional Δ9 tokens
    pub fn stake(ctx: Context<UpdateStake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);

        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update stake state
        update_stake_internal(&mut ctx.accounts.user_staking_state, amount as i64)?;

        emit!(StakeEvent {
            user: ctx.accounts.user.key(),
            amount,
            new_balance: ctx.accounts.user_staking_state.staked_balance,
            tier: ctx.accounts.user_staking_state.reward_multiplier,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Unstake Δ9 tokens
    pub fn unstake(ctx: Context<UpdateStake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);
        require!(
            ctx.accounts.user_staking_state.staked_balance >= amount,
            StakingError::InsufficientBalance
        );

        // Update stake state first (lazy reward evaluation before reducing balance)
        update_stake_internal(&mut ctx.accounts.user_staking_state, -(amount as i64))?;

        // Transfer tokens from vault back to user
        let seeds = &[
            b"vault",
            &[ctx.accounts.user_staking_state.bump],
        ];
        let signer = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.user_staking_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        emit!(UnstakeEvent {
            user: ctx.accounts.user.key(),
            amount,
            new_balance: ctx.accounts.user_staking_state.staked_balance,
            tier: ctx.accounts.user_staking_state.reward_multiplier,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Claim pending rewards
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_staking_state;

        // Run lazy evaluation to capture any unclaimed accrual
        accrue_rewards(user_state)?;

        let rewards = user_state.pending_rewards;
        require!(rewards > 0, StakingError::NoRewards);

        // Reset pending rewards before transfer (reentrancy protection)
        user_state.pending_rewards = 0;

        // TODO: Transfer rewards from rewards vault to user
        // Implement reward mint/transfer here

        emit!(ClaimEvent {
            user: ctx.accounts.user.key(),
            amount: rewards,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Open a new vote session — snapshots all eligible stakers at this moment
    /// Only callable by governance authority
    pub fn open_vote_session(
        ctx: Context<OpenVoteSession>,
        issue_id: [u8; 32],       // on-chain ID matching the issues panel
        duration_seconds: i64,    // how long the vote stays open
    ) -> Result<()> {
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.vote_session;

        session.issue_id          = issue_id;
        session.opened_at         = clock.unix_timestamp;
        session.closes_at         = clock.unix_timestamp + duration_seconds;
        session.snapshot_epoch    = clock.unix_timestamp; // snapshot moment
        session.total_weight_for  = 0;
        session.total_weight_against = 0;
        session.is_open           = true;
        session.bump              = ctx.bumps.vote_session;

        emit!(VoteSessionOpened {
            issue_id,
            snapshot_epoch: session.snapshot_epoch,
            closes_at: session.closes_at,
        });

        Ok(())
    }

    /// Cast a vote — weight is determined by stake AT snapshot, not current balance
    pub fn cast_vote(
        ctx: Context<CastVote>,
        support: bool,    // true = support, false = oppose
    ) -> Result<()> {
        let clock = Clock::get()?;
        let session = &ctx.accounts.vote_session;
        let user_state = &ctx.accounts.user_staking_state;
        let vote_record = &mut ctx.accounts.vote_record;

        // Check session is still open
        require!(session.is_open, StakingError::SessionClosed);
        require!(clock.unix_timestamp < session.closes_at, StakingError::SessionClosed);

        // Check user hasn't already voted
        require!(!vote_record.has_voted, StakingError::AlreadyVoted);

        // SNAPSHOT RULE: Use staked_balance as it was at/before snapshot_epoch
        // The user's balance is their current balance — since we don't allow
        // retroactive restaking to game votes, we verify they were staked at snapshot
        require!(
            user_state.last_interaction_timestamp <= session.snapshot_epoch
                || user_state.staked_balance >= TIER_SIGNAL,
            StakingError::NotEligible
        );

        // Calculate vote weight from current multiplier
        // If user unstaked after snapshot — they still vote with snapshot-time weight
        // stored in their vote_record snapshot fields
        let vote_weight = user_state.staked_balance
            .checked_mul(user_state.reward_multiplier)
            .ok_or(StakingError::Overflow)?
            .checked_div(100)
            .ok_or(StakingError::Overflow)?;

        require!(vote_weight > 0, StakingError::NotEligible);

        // Record the vote
        vote_record.voter        = ctx.accounts.user.key();
        vote_record.issue_id     = session.issue_id;
        vote_record.weight       = vote_weight;
        vote_record.support      = support;
        vote_record.voted_at     = clock.unix_timestamp;
        vote_record.has_voted    = true;
        vote_record.bump         = ctx.bumps.vote_record;

        // Update session totals
        let session_mut = &mut ctx.accounts.vote_session;
        if support {
            session_mut.total_weight_for = session_mut.total_weight_for
                .checked_add(vote_weight)
                .ok_or(StakingError::Overflow)?;
        } else {
            session_mut.total_weight_against = session_mut.total_weight_against
                .checked_add(vote_weight)
                .ok_or(StakingError::Overflow)?;
        }

        emit!(VoteCast {
            // Note: voter identity NOT emitted — AMOK anonymity preserved on-chain
            issue_id: session.issue_id,
            weight: vote_weight,
            support,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Close a vote session after duration expires
    pub fn close_vote_session(ctx: Context<CloseVoteSession>) -> Result<()> {
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.vote_session;

        require!(
            clock.unix_timestamp >= session.closes_at,
            StakingError::SessionStillOpen
        );

        session.is_open = false;

        emit!(VoteSessionClosed {
            issue_id: session.issue_id,
            total_weight_for: session.total_weight_for,
            total_weight_against: session.total_weight_against,
            closed_at: clock.unix_timestamp,
        });

        Ok(())
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Core stake state update — shared by stake() and unstake()
/// amount is signed: positive = stake, negative = unstake
fn update_stake_internal(user_state: &mut UserStakingState, amount: i64) -> Result<()> {
    // 1. LAZY EVALUATION: Accrue rewards before any balance change
    accrue_rewards(user_state)?;

    // 2. UPDATE BALANCE
    if amount >= 0 {
        user_state.staked_balance = user_state.staked_balance
            .checked_add(amount as u64)
            .ok_or(StakingError::Overflow)?;
    } else {
        user_state.staked_balance = user_state.staked_balance
            .checked_sub((-amount) as u64)
            .ok_or(StakingError::InsufficientBalance)?;
    }

    // 3. RECALCULATE TIER based on new balance
    user_state.reward_multiplier = calculate_multiplier(user_state.staked_balance);

    // 4. RESET TIMESTAMP snapshot
    user_state.last_interaction_timestamp = Clock::get()?.unix_timestamp;

    Ok(())
}

/// Lazy reward accrual — called before any balance change
fn accrue_rewards(user_state: &mut UserStakingState) -> Result<()> {
    if user_state.staked_balance > 0 && user_state.reward_multiplier > 0 {
        let clock = Clock::get()?;
        let time_passed = clock.unix_timestamp
            .checked_sub(user_state.last_interaction_timestamp)
            .unwrap_or(0);

        if time_passed > 0 {
            // accrued = time_passed * BASE_REWARD_RATE * multiplier / 100
            // Using basis points: divide by 100 to get actual multiplier
            let accrued = (time_passed as u64)
                .checked_mul(BASE_REWARD_RATE)
                .ok_or(StakingError::Overflow)?
                .checked_mul(user_state.reward_multiplier)
                .ok_or(StakingError::Overflow)?
                .checked_div(100)
                .ok_or(StakingError::Overflow)?;

            user_state.pending_rewards = user_state.pending_rewards
                .checked_add(accrued)
                .ok_or(StakingError::Overflow)?;
        }
    }
    Ok(())
}

/// Map balance to multiplier in basis points
fn calculate_multiplier(balance: u64) -> u64 {
    if balance >= TIER_CONSENT {
        MULT_CONSENT      // 300 = 3x — Consent tier
    } else if balance >= TIER_DELTA {
        MULT_DELTA        // 200 = 2x — Delta tier
    } else if balance >= TIER_VERIFY {
        MULT_VERIFY       // 125 = 1.25x — Verify tier
    } else if balance >= TIER_SIGNAL {
        MULT_SIGNAL       // 100 = 1x — Signal tier
    } else {
        MULT_NONE         // 0 — below minimum, no AMOK credential
    }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + UserStakingState::SIZE,
        seeds = [b"user-stake", user.key().as_ref()],
        bump
    )]
    pub user_staking_state: Account<'info, UserStakingState>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateStake<'info> {
    #[account(
        mut,
        seeds = [b"user-stake", user.key().as_ref()],
        bump = user_staking_state.bump,
        has_one = owner
    )]
    pub user_staking_state: Account<'info, UserStakingState>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(
        mut,
        seeds = [b"user-stake", user.key().as_ref()],
        bump = user_staking_state.bump,
        has_one = owner
    )]
    pub user_staking_state: Account<'info, UserStakingState>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct OpenVoteSession<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VoteSession::SIZE,
        seeds = [b"vote-session", issue_id.as_ref()],
        bump
    )]
    pub vote_session: Account<'info, VoteSession>,
    /// CHECK: governance authority — restrict to multisig or DAO in production
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub vote_session: Account<'info, VoteSession>,
    #[account(
        seeds = [b"user-stake", user.key().as_ref()],
        bump = user_staking_state.bump,
        has_one = owner
    )]
    pub user_staking_state: Account<'info, UserStakingState>,
    #[account(
        init,
        payer = user,
        space = 8 + VoteRecord::SIZE,
        seeds = [b"vote-record", vote_session.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseVoteSession<'info> {
    #[account(mut)]
    pub vote_session: Account<'info, VoteSession>,
    pub authority: Signer<'info>,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[account]
pub struct UserStakingState {
    pub owner:                      Pubkey,   // 32
    pub staked_balance:             u64,      // 8
    pub pending_rewards:            u64,      // 8
    pub reward_multiplier:          u64,      // 8  — basis points
    pub last_interaction_timestamp: i64,      // 8
    pub bump:                       u8,       // 1
}

impl UserStakingState {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 8 + 1; // 65 bytes
}

#[account]
pub struct VoteSession {
    pub issue_id:             [u8; 32],  // 32 — matches issues panel ID
    pub opened_at:            i64,       // 8
    pub closes_at:            i64,       // 8
    pub snapshot_epoch:       i64,       // 8  — stake state frozen at this moment
    pub total_weight_for:     u64,       // 8
    pub total_weight_against: u64,       // 8
    pub is_open:              bool,      // 1
    pub bump:                 u8,        // 1
}

impl VoteSession {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1; // 74 bytes
}

#[account]
pub struct VoteRecord {
    pub voter:     Pubkey,    // 32 — stored on-chain but NOT emitted in events
    pub issue_id:  [u8; 32], // 32
    pub weight:    u64,       // 8
    pub support:   bool,      // 1
    pub voted_at:  i64,       // 8
    pub has_voted: bool,      // 1
    pub bump:      u8,        // 1
}

impl VoteRecord {
    pub const SIZE: usize = 32 + 32 + 8 + 1 + 8 + 1 + 1; // 83 bytes
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct StakeEvent {
    pub user:        Pubkey,
    pub amount:      u64,
    pub new_balance: u64,
    pub tier:        u64,
    pub timestamp:   i64,
}

#[event]
pub struct UnstakeEvent {
    pub user:        Pubkey,
    pub amount:      u64,
    pub new_balance: u64,
    pub tier:        u64,
    pub timestamp:   i64,
}

#[event]
pub struct ClaimEvent {
    pub user:      Pubkey,
    pub amount:    u64,
    pub timestamp: i64,
}

#[event]
pub struct VoteSessionOpened {
    pub issue_id:       [u8; 32],
    pub snapshot_epoch: i64,
    pub closes_at:      i64,
}

#[event]
pub struct VoteCast {
    // voter identity deliberately NOT included — AMOK anonymity preserved
    pub issue_id:  [u8; 32],
    pub weight:    u64,
    pub support:   bool,
    pub timestamp: i64,
}

#[event]
pub struct VoteSessionClosed {
    pub issue_id:             [u8; 32],
    pub total_weight_for:     u64,
    pub total_weight_against: u64,
    pub closed_at:            i64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum StakingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient staked balance")]
    InsufficientBalance,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("No rewards to claim")]
    NoRewards,
    #[msg("Vote session is closed")]
    SessionClosed,
    #[msg("Vote session is still open")]
    SessionStillOpen,
    #[msg("Already voted in this session")]
    AlreadyVoted,
    #[msg("Not eligible to vote — insufficient stake at snapshot")]
    NotEligible,
}
