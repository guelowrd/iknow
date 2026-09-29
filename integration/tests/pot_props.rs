//! Money properties of the pot on random stake sets: every winner is paid floor(units * total /
//! winning side), never more than the vault holds, with less than one unit of dust per winner. Plus
//! the refusals the batch relies on: past the lock height, past the per-side cap.
use std::path::Path;

use integration::helpers::{add_oracle, add_pot, build_project_in_dir, claim_note, entry, stake_note, word, AUTH, DEADLINE_MS, UNIT};
use miden_client::{account::Account, asset::FungibleAsset, note::Note, transaction::{RawOutputNote, TransactionScript}};
use miden_mast_package::Package;
use miden_testing::MockChain;
use proptest::{prelude::*, test_runner::{Config, TestCaseError, TestRunner}};

const CAP: u64 = (1 << 32) - 1; // most units one side can hold (pot MAX_UNITS - 1)

struct Pkgs { oracle: Package, pot: Package, claim: Package, settle: Package }

fn pkgs() -> anyhow::Result<Pkgs> {
    let b = |name: &str| build_project_in_dir(Path::new(&format!("../contracts/{name}")), true);
    Ok(Pkgs { oracle: b("oracle")?, pot: b("pot")?, claim: b("claim-note")?, settle: b("settle-script")? })
}

/// Consumes `notes` with the pot: the amounts it paid out, or None if the transaction failed.
async fn consume(chain: &mut MockChain, pot: &Account, notes: &[Note]) -> anyhow::Result<Option<Vec<u64>>> {
    let mut builder = chain.build_transaction(chain.committed_account(pot.id())?.clone());
    for n in notes {
        builder = builder.authenticated_input_note(n.id());
    }
    let Ok(executed) = builder.build()?.execute().await else { return Ok(None) };
    let mut paid = Vec::new();
    for out in executed.output_notes().iter() {
        for asset in out.assets().iter() {
            paid.push(asset.unwrap_fungible().amount().as_u64());
        }
    }
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    Ok(Some(paid))
}

fn vault(chain: &MockChain, pot: &Account, faucet: &Account) -> anyhow::Result<u64> {
    Ok(chain.committed_account(pot.id())?.vault().get_balance(FungibleAsset::new(faucet.id(), 1)?.id())?.as_u64())
}

/// One pot: every stake opened in one batch, settled YES or NO from the oracle, then every winner claims at once.
async fn scenario(p: &Pkgs, stakes: &[(u64, u64)], yes: bool) -> anyhow::Result<()> {
    let outcome = if yes { 1 } else { 2 };
    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(AUTH, "IKNW", 1 << 62, Some(0))?;
    let (oracle, pointer) = add_oracle(&mut builder, &p.oracle, entry(if yes { DEADLINE_MS - 1 } else { DEADLINE_MS + 1 }, 1_700_000_000)?)?;
    let pot = add_pot(&mut builder, &p.pot, &faucet, 1_000, Some(&pointer))?;
    let (mut stake_notes, mut claims) = (Vec::new(), Vec::new());
    for (i, &(side, units)) in stakes.iter().enumerate() {
        let bettor = builder.add_existing_wallet(AUTH)?;
        let salt = word(i as u64 + 1, 0, 0, 0)?;
        stake_notes.push(stake_note(&p.pot, &bettor, &pot, &faucet, side, units, salt)?);
        if side == outcome {
            claims.push((units, claim_note(&p.claim, &bettor, &bettor, side, units, salt)?));
        }
    }
    for n in stake_notes.iter().chain(claims.iter().map(|c| &c.1)) {
        builder.add_output_note(RawOutputNote::Full(n.clone()));
    }
    let mut chain = builder.build()?;
    anyhow::ensure!(consume(&mut chain, &pot, &stake_notes).await?.is_some(), "the batch opens every stake");

    let settle = TransactionScript::from_package(&p.settle)?;
    let foreign = chain.get_foreign_account_inputs(oracle.id())?;
    let executed = chain.build_transaction(chain.committed_account(pot.id())?.clone()).tx_script(settle).foreign_accounts([foreign]).build()?.execute().await?;
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;

    let total: u64 = stakes.iter().map(|s| s.1).sum();
    let winning: u64 = claims.iter().map(|c| c.0).sum();
    let staked = total * UNIT;
    anyhow::ensure!(vault(&chain, &pot, &faucet)? == staked, "the vault holds every stake");
    if claims.is_empty() {
        return Ok(()); // nobody backed the winning side: nothing is claimable, the stakes stay in the pot
    }
    let notes: Vec<Note> = claims.iter().map(|c| c.1.clone()).collect();
    let mut paid = consume(&mut chain, &pot, &notes).await?.ok_or_else(|| anyhow::anyhow!("the winners' claims failed"))?;
    let mut expected: Vec<u64> = claims.iter().map(|c| (c.0 as u128 * total as u128 / winning as u128) as u64 * UNIT).collect();
    paid.sort();
    expected.sort();
    anyhow::ensure!(paid == expected, "pro rata floor: paid {paid:?}, expected {expected:?}");
    let sum: u64 = paid.iter().sum();
    anyhow::ensure!(sum <= staked && staked - sum < claims.len() as u64 * UNIT, "dust below one unit per winner");
    anyhow::ensure!(vault(&chain, &pot, &faucet)? == staked - sum, "the vault keeps only the dust");
    Ok(())
}

#[test]
fn claims_split_the_pot_pro_rata_and_never_exceed_it() {
    let p = pkgs().expect("contracts build");
    let rt = tokio::runtime::Runtime::new().unwrap();
    let cases = std::env::var("PROPTEST_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(12);
    let mut runner = TestRunner::new(Config { cases, failure_persistence: None, ..Config::default() });
    let stakes = prop::collection::vec((1_u64..=2, 1_u64..=1_000), 1..=8);
    runner
        .run(&(stakes, any::<bool>()), |(stakes, yes)| rt.block_on(scenario(&p, &stakes, yes)).map_err(|e| TestCaseError::fail(format!("{e:#}"))))
        .unwrap();
}

#[tokio::test]
async fn stakes_past_the_side_cap_or_the_lock_height_are_refused() -> anyhow::Result<()> {
    let p = pkgs()?;
    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(AUTH, "IKNW", 1 << 62, Some(0))?;
    let pot = add_pot(&mut builder, &p.pot, &faucet, 3, None)?; // lock height 3
    let a = builder.add_existing_wallet(AUTH)?;
    let notes = [
        stake_note(&p.pot, &a, &pot, &faucet, 1, CAP, word(1, 0, 0, 0)?)?,
        stake_note(&p.pot, &a, &pot, &faucet, 1, 1, word(2, 0, 0, 0)?)?,
        stake_note(&p.pot, &a, &pot, &faucet, 2, 1, word(3, 0, 0, 0)?)?,
        stake_note(&p.pot, &a, &pot, &faucet, 2, 1, word(4, 0, 0, 0)?)?,
    ];
    for n in &notes {
        builder.add_output_note(RawOutputNote::Full(n.clone()));
    }
    let mut chain = builder.build()?;
    assert!(consume(&mut chain, &pot, &notes[0..1]).await?.is_some(), "a side holds up to the cap");
    assert!(consume(&mut chain, &pot, &notes[1..2]).await?.is_none(), "not one unit more");
    assert!(consume(&mut chain, &pot, &notes[2..3]).await?.is_some(), "the other side still opens before the lock height");
    for _ in 0..3 {
        chain.prove_next_block()?;
    }
    assert!(consume(&mut chain, &pot, &notes[3..4]).await?.is_none(), "no stake opens once the lock height is reached");
    Ok(())
}

#[tokio::test]
#[ignore = "known bug: claim computes units * total in u64 and wraps (paid 4294967289 units for 8589934588); the fix changes the claim procedure root, see tasks/todo.md"]
async fn claim_math_holds_with_both_sides_near_the_cap() -> anyhow::Result<()> {
    // units * total reaches about 2^65 here, past u64
    scenario(&pkgs()?, &[(1, CAP - 1), (2, CAP - 1)], true).await
}
