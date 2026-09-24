//! Settle: the pot reads the oracle through FPI and fixes YES, NO, VOID, or stays pending.
use std::path::Path;

use integration::helpers::{add_oracle, add_pot, build_project_in_dir, entry, pot_slot, AUTH, DEADLINE_MS, GRACE_S};
use miden_client::{transaction::TransactionScript, Word};
use miden_testing::MockChain;

const DEADLINE_S: u32 = (DEADLINE_MS / 1000) as u32;

/// Settles a fresh pot against `oracle_entry` with the reference block at `block_ts`.
/// Returns the outcome, or None if settle panicked (pending).
async fn settle(oracle_entry: Word, block_ts: u32) -> anyhow::Result<Option<u64>> {
    let oracle_pkg = build_project_in_dir(Path::new("../contracts/oracle"), true)?;
    let pot_pkg = build_project_in_dir(Path::new("../contracts/pot"), true)?;
    let settle_pkg = build_project_in_dir(Path::new("../contracts/settle-script"), true)?;

    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(AUTH, "IKNW", 1_000_000_000_000, Some(0))?;
    let (oracle, pointer) = add_oracle(&mut builder, &oracle_pkg, oracle_entry)?;
    let pot = add_pot(&mut builder, &pot_pkg, &faucet, 1_000, Some(&pointer))?;
    let mut chain = builder.build()?;
    chain.prove_next_block_at(block_ts)?;

    let foreign = chain.get_foreign_account_inputs(oracle.id())?;
    let script = TransactionScript::from_package(&settle_pkg)?;
    let executed = match chain
        .build_transaction(pot.clone())
        .tx_script(script)
        .foreign_accounts([foreign])
        .build()?
        .execute()
        .await
    {
        Ok(executed) => executed,
        Err(_) => return Ok(None),
    };
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let outcome = chain.committed_account(pot.id())?.storage().get_item(&pot_slot("outcome")?)?;
    Ok(Some(outcome.as_elements()[0].as_canonical_u64()))
}

#[tokio::test]
async fn post_before_deadline_is_yes() -> anyhow::Result<()> {
    assert_eq!(settle(entry(DEADLINE_MS - 1, 1_700_000_000)?, DEADLINE_S).await?, Some(1));
    Ok(())
}

#[tokio::test]
async fn post_after_deadline_is_no() -> anyhow::Result<()> {
    assert_eq!(settle(entry(DEADLINE_MS, 1_800_000_000)?, DEADLINE_S).await?, Some(2));
    Ok(())
}

#[tokio::test]
async fn heartbeat_past_deadline_without_post_is_no() -> anyhow::Result<()> {
    assert_eq!(settle(entry(0, DEADLINE_S as u64)?, DEADLINE_S).await?, Some(2));
    Ok(())
}

#[tokio::test]
async fn heartbeat_past_deadline_but_chain_not_yet_is_pending() -> anyhow::Result<()> {
    assert_eq!(settle(entry(0, DEADLINE_S as u64)?, DEADLINE_S - 1).await?, None);
    Ok(())
}

#[tokio::test]
async fn stale_heartbeat_before_grace_is_pending() -> anyhow::Result<()> {
    assert_eq!(settle(entry(0, 1_700_000_000)?, DEADLINE_S + 10).await?, None);
    Ok(())
}

#[tokio::test]
async fn stale_heartbeat_after_grace_is_void() -> anyhow::Result<()> {
    assert_eq!(settle(entry(0, 1_700_000_000)?, DEADLINE_S + GRACE_S as u32).await?, Some(3));
    Ok(())
}
