//! Full flow: stakes batched, settle, winners claim pro rata, losers and replays fail.
use std::path::Path;

use integration::helpers::{
    add_oracle, add_pot, build_project_in_dir, claim_note, entry, pot_slot, stake_note, word, AUTH, DEADLINE_MS, UNIT,
};
use miden_client::{
    account::Account, asset::FungibleAsset, note::Note, transaction::{RawOutputNote, TransactionScript}, Word,
};
use miden_mast_package::Package;
use miden_testing::MockChain;

struct World {
    chain: MockChain,
    pot: Account,
    oracle: Account,
    faucet: Account,
    settle_pkg: Package,
    /// Claim notes seeded on chain: [a_ok, b_ok, c_loser, a_wrong_units, a_again_by_b, op_for_a, op_for_b, op_for_c]
    claims: Vec<Note>,
}

/// A: 6 YES, B: 4 YES, C: 5 NO, all opened in one batch, plus every claim note the tests use.
async fn world(oracle_entry: Word) -> anyhow::Result<World> {
    let oracle_pkg = build_project_in_dir(Path::new("../contracts/oracle"), true)?;
    let pot_pkg = build_project_in_dir(Path::new("../contracts/pot"), true)?;
    let claim_pkg = build_project_in_dir(Path::new("../contracts/claim-note"), true)?;
    let settle_pkg = build_project_in_dir(Path::new("../contracts/settle-script"), true)?;

    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(AUTH, "IKNW", 1_000_000_000_000, Some(0))?;
    let (oracle, pointer) = add_oracle(&mut builder, &oracle_pkg, oracle_entry)?;
    let pot = add_pot(&mut builder, &pot_pkg, &faucet, 1_000, Some(&pointer))?;
    let a = builder.add_existing_wallet(AUTH)?;
    let b = builder.add_existing_wallet(AUTH)?;
    let c = builder.add_existing_wallet(AUTH)?;
    let notes = [
        stake_note(&pot_pkg, &a, &pot, &faucet, 1, 6, word(1, 0, 0, 0)?)?,
        stake_note(&pot_pkg, &b, &pot, &faucet, 1, 4, word(2, 0, 0, 0)?)?,
        stake_note(&pot_pkg, &c, &pot, &faucet, 2, 5, word(3, 0, 0, 0)?)?,
    ];
    let claims = vec![
        claim_note(&claim_pkg, &a, &a, 1, 6, word(1, 0, 0, 0)?)?,
        claim_note(&claim_pkg, &b, &b, 1, 4, word(2, 0, 0, 0)?)?,
        claim_note(&claim_pkg, &c, &c, 2, 5, word(3, 0, 0, 0)?)?,
        claim_note(&claim_pkg, &a, &a, 1, 7, word(1, 0, 0, 0)?)?,
        claim_note(&claim_pkg, &b, &a, 1, 6, word(1, 0, 0, 0)?)?,
        claim_note(&claim_pkg, &c, &a, 1, 6, word(1, 0, 0, 0)?)?,
        claim_note(&claim_pkg, &c, &b, 1, 4, word(2, 0, 0, 0)?)?,
        claim_note(&claim_pkg, &c, &c, 2, 5, word(3, 0, 0, 0)?)?,
    ];
    for n in notes.iter().chain(claims.iter()) {
        builder.add_output_note(RawOutputNote::Full(n.clone()));
    }
    let mut chain = builder.build()?;
    let executed = chain
        .build_transaction(pot.clone())
        .authenticated_input_notes(notes.iter().map(|n| n.id()))
        .build()?
        .execute()
        .await?;
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    Ok(World { chain, pot, oracle, faucet, settle_pkg, claims })
}

async fn settle(w: &mut World) -> anyhow::Result<()> {
    let foreign = w.chain.get_foreign_account_inputs(w.oracle.id())?;
    let pot = w.chain.committed_account(w.pot.id())?.clone();
    let executed = w
        .chain
        .build_transaction(pot)
        .tx_script(TransactionScript::from_package(&w.settle_pkg)?)
        .foreign_accounts([foreign])
        .build()?
        .execute()
        .await?;
    w.chain.add_pending_executed_transaction(&executed)?;
    w.chain.prove_next_block()?;
    Ok(())
}

/// Consumes the claim notes with the pot; returns the payout amounts of the P2ID notes it emitted,
/// or None if the transaction failed.
async fn claim(w: &mut World, notes: &[Note]) -> anyhow::Result<Option<Vec<u64>>> {
    let pot = w.chain.committed_account(w.pot.id())?.clone();
    let mut builder = w.chain.build_transaction(pot);
    for n in notes {
        builder = builder.authenticated_input_note(n.id());
    }
    let executed = match builder.build()?.execute().await {
        Ok(executed) => executed,
        Err(_) => return Ok(None),
    };
    let mut amounts = Vec::new();
    for out in executed.output_notes().iter() {
        for asset in out.assets().iter() {
            amounts.push(asset.unwrap_fungible().amount().as_u64());
        }
    }
    w.chain.add_pending_executed_transaction(&executed)?;
    w.chain.prove_next_block()?;
    Ok(Some(amounts))
}

#[tokio::test]
async fn winners_split_the_pot_pro_rata() -> anyhow::Result<()> {
    let mut w = world(entry(DEADLINE_MS - 1, 1_700_000_000)?).await?;
    settle(&mut w).await?;
    let claims = [w.claims[0].clone(), w.claims[1].clone()];
    let paid = claim(&mut w, &claims).await?.expect("claims succeed");
    assert_eq!(paid, vec![9 * UNIT, 6 * UNIT], "6/10 and 4/10 of a 15 unit pot");
    let pot = w.chain.committed_account(w.pot.id())?;
    assert_eq!(pot.vault().get_balance(FungibleAsset::new(w.faucet.id(), 1)?.id())?.as_u64(), 0, "pot emptied");
    Ok(())
}

#[tokio::test]
async fn loser_double_claim_wrong_tuple_and_early_claim_fail() -> anyhow::Result<()> {
    let mut w = world(entry(DEADLINE_MS - 1, 1_700_000_000)?).await?;
    let (a_ok, c_loser, a_wrong, a_again) =
        (w.claims[0].clone(), w.claims[2].clone(), w.claims[3].clone(), w.claims[4].clone());
    assert!(claim(&mut w, &[a_ok.clone()]).await?.is_none(), "claim before settle fails");
    settle(&mut w).await?;
    assert!(claim(&mut w, &[c_loser]).await?.is_none(), "losing side cannot claim");
    assert!(claim(&mut w, &[a_wrong]).await?.is_none(), "wrong units do not match the commitment");
    assert_eq!(claim(&mut w, &[a_ok]).await?, Some(vec![9 * UNIT]));
    assert!(claim(&mut w, &[a_again]).await?.is_none(), "a claimed position cannot be claimed twice");
    Ok(())
}

#[tokio::test]
async fn operator_can_claim_on_behalf_and_void_refunds_stakes() -> anyhow::Result<()> {
    // Stale heartbeat, chain far past the grace period: settles VOID.
    let mut w = world(entry(0, 1_700_000_000)?).await?;
    w.chain.prove_next_block_at((DEADLINE_MS / 1000) as u32 + 40 * 86_400)?;
    settle(&mut w).await?;
    let outcome = w.chain.committed_account(w.pot.id())?.storage().get_item(&pot_slot("outcome")?)?;
    assert_eq!(outcome.as_elements()[0].as_canonical_u64(), 3);
    // Claim notes created by a third party (the operator) still pay the committed target.
    let claims = w.claims[5..8].to_vec();
    assert_eq!(claim(&mut w, &claims).await?, Some(vec![6 * UNIT, 4 * UNIT, 5 * UNIT]));
    Ok(())
}
