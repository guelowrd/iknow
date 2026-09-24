//! Spike: the pot reads an oracle map entry through FPI; the debug procedure dumps the 16 output
//! felts into storage so the layout can be read back here.
use std::path::Path;

use integration::helpers::{add_pot, build_project_in_dir, pot_slot, procedure_root, word, OraclePointer, AUTH};
use miden_client::{
    account::{component::InitStorageData, AccountBuilder, AccountComponent, AccountType, StorageMapKey, StorageSlotName},
    crypto::RandomCoin,
    note::NoteScript,
    transaction::RawOutputNote,
    Felt, Word,
};
use miden_standards::testing::note::NoteBuilder;
use miden_testing::{AccountState, MockChain};

pub const VALUE_MS: u64 = 1_777_045_455_067;
pub const OBSERVED_S: u64 = 1_758_700_000;

#[tokio::test]
async fn pot_reads_oracle_entry_via_fpi() -> anyhow::Result<()> {
    let oracle_pkg = build_project_in_dir(Path::new("../contracts/oracle"), true)?;
    let pot_pkg = build_project_in_dir(Path::new("../contracts/pot"), true)?;
    let probe_pkg = build_project_in_dir(Path::new("../contracts/fpi-probe"), true)?;

    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(AUTH, "IKNW", 1_000_000_000_000, Some(0))?;
    let operator = builder.add_existing_wallet(AUTH)?;

    let key = word(5, 5, 5, 5)?;
    let entry = word(0, VALUE_MS, 0, OBSERVED_S)?;
    let mut init = InitStorageData::default();
    init.insert_map_entry(StorageSlotName::new("oracle::oracle::entries")?, key, entry)?;
    let component = AccountComponent::from_package(&oracle_pkg, &init)?;
    let oracle = builder.add_account_from_builder(
        AUTH,
        AccountBuilder::new([7_u8; 32]).account_type(AccountType::Public).with_component(component),
        AccountState::Exists,
    )?;
    let pointer = OraclePointer {
        id_word: Word::from([oracle.id().prefix().as_felt(), oracle.id().suffix(), Felt::ZERO, Felt::ZERO]),
        root: procedure_root(&oracle_pkg, "get-entry")?,
        feed_key: key,
    };
    let pot = add_pot(&mut builder, &pot_pkg, &faucet, 1_000, Some(&pointer))?;

    let script = NoteScript::from_package(&probe_pkg)?;
    let mut rng = RandomCoin::new(Word::from(script.root()));
    let note = NoteBuilder::new(operator.id(), &mut rng).package(probe_pkg.clone()).build()?;
    builder.add_output_note(RawOutputNote::Full(note.clone()));

    let mut chain = builder.build()?;
    let foreign = chain.get_foreign_account_inputs(oracle.id())?;
    let executed = chain
        .build_transaction(pot.clone())
        .authenticated_input_note(note.id())
        .foreign_accounts([foreign])
        .build()?
        .execute()
        .await?;
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;

    let committed = chain.committed_account(pot.id())?;
    let mut outputs = Vec::new();
    for i in 0..16_u64 {
        let v = committed.storage().get_map_item(&pot_slot("positions")?, StorageMapKey::new(word(i, 0, 0, 0)?))?;
        outputs.push(v.as_elements()[0].as_canonical_u64());
    }
    println!("FPI outputs: {outputs:?}");
    let value_at = outputs.iter().position(|&v| v == VALUE_MS);
    let observed_at = outputs.iter().position(|&v| v == OBSERVED_S);
    println!("value at {value_at:?}, observed_at at {observed_at:?}");
    assert!(value_at.is_some() && observed_at.is_some(), "entry not found in FPI outputs");
    Ok(())
}
