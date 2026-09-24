//! 30 private stake notes opened by the pot in one transaction, totals and commitments checked on
//! chain, and a stake note taken back by its sender's standard wallet.
use std::{path::Path, time::Instant};

use integration::helpers::{add_pot, build_project_in_dir, pot_slot, position_key, stake_note, word, AUTH, UNIT};
use miden_client::{account::{Account, StorageMapKey}, asset::FungibleAsset, transaction::RawOutputNote};
use miden_testing::MockChain;

#[tokio::test]
async fn pot_opens_thirty_stakes_in_one_batch() -> anyhow::Result<()> {
    let pot_pkg = build_project_in_dir(Path::new("../contracts/pot"), true)?;
    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(AUTH, "IKNW", 1_000_000_000_000, Some(0))?;
    let pot = add_pot(&mut builder, &pot_pkg, &faucet, 1_000, None)?;
    let bettors: Vec<Account> = (0..3).map(|_| builder.add_existing_wallet(AUTH)).collect::<Result<_, _>>()?;

    let mut notes = Vec::new();
    let mut expected = [0_u64, 0_u64];
    let mut keys = Vec::new();
    for i in 0..30_u64 {
        let side = if i % 4 == 0 { 2 } else { 1 };
        let units = 1 + i % 7;
        let salt = word(i, 42, 7, 1)?;
        let bettor = &bettors[(i % 3) as usize];
        notes.push(stake_note(&pot_pkg, bettor, &pot, &faucet, side, units, salt)?);
        expected[(side - 1) as usize] += units;
        keys.push(position_key(bettor, side, units, salt));
    }
    for note in &notes {
        builder.add_output_note(RawOutputNote::Full(note.clone()));
    }
    let mut chain = builder.build()?;

    let started = Instant::now();
    let executed = chain
        .build_transaction(pot.clone())
        .authenticated_input_notes(notes.iter().map(|n| n.id()))
        .build()?
        .execute()
        .await?;
    println!("batch of 30 executed in {:?}", started.elapsed());
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;

    let committed = chain.committed_account(pot.id())?;
    let totals = committed.storage().get_item(&pot_slot("totals")?)?;
    assert_eq!(totals.as_elements()[0].as_canonical_u64(), expected[0], "yes units");
    assert_eq!(totals.as_elements()[1].as_canonical_u64(), expected[1], "no units");
    for key in &keys {
        let v = committed.storage().get_map_item(&pot_slot("positions")?, StorageMapKey::new(*key))?;
        assert_eq!(v.as_elements()[0].as_canonical_u64(), 1, "position open");
    }
    let staked = (expected[0] + expected[1]) * UNIT;
    assert_eq!(committed.vault().get_balance(FungibleAsset::new(faucet.id(), 1)?.id())?.as_u64(), staked);
    Ok(())
}

#[tokio::test]
async fn sender_takes_back_unopened_stake() -> anyhow::Result<()> {
    let pot_pkg = build_project_in_dir(Path::new("../contracts/pot"), true)?;
    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(AUTH, "IKNW", 1_000_000_000_000, Some(0))?;
    let pot = add_pot(&mut builder, &pot_pkg, &faucet, 1_000, None)?;
    let bettor = builder.add_existing_wallet(AUTH)?;
    let note = stake_note(&pot_pkg, &bettor, &pot, &faucet, 1, 5, word(1, 2, 3, 4)?)?;
    builder.add_output_note(RawOutputNote::Full(note.clone()));
    let mut chain = builder.build()?;

    let executed = chain.build_transaction(bettor.clone()).authenticated_input_note(note.id()).build()?.execute().await?;
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let wallet = chain.committed_account(bettor.id())?;
    assert_eq!(wallet.vault().get_balance(FungibleAsset::new(faucet.id(), 1)?.id())?.as_u64(), 5 * UNIT);
    Ok(())
}
