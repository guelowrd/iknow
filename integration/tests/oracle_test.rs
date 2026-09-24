//! Oracle: publish_entry writes the Pragma-shaped entry, value is write-once, observed_at monotonic.
use std::path::Path;

use integration::helpers::{add_oracle, build_project_in_dir, entry, publish_script, word, FEED_KEY, ORACLE_ENTRIES_SLOT};
use miden_client::account::{StorageMapKey, StorageSlotName};
use miden_testing::MockChain;

async fn publish(seed: miden_client::Word, new: miden_client::Word) -> anyhow::Result<Option<miden_client::Word>> {
    let oracle_pkg = build_project_in_dir(Path::new("../contracts/oracle"), true)?;
    let mut builder = MockChain::builder();
    let (oracle, _) = add_oracle(&mut builder, &oracle_pkg, seed)?;
    let mut chain = builder.build()?;
    let script = publish_script(&oracle_pkg, FEED_KEY, new)?;
    let executed = match chain.build_transaction(oracle.clone()).tx_script(script).build()?.execute().await {
        Ok(executed) => executed,
        Err(_) => return Ok(None),
    };
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let stored = chain
        .committed_account(oracle.id())?
        .storage()
        .get_map_item(&StorageSlotName::new(ORACLE_ENTRIES_SLOT)?, StorageMapKey::new(FEED_KEY))?;
    Ok(Some(stored))
}

#[tokio::test]
async fn publish_sets_entry_and_heartbeat_moves_forward() -> anyhow::Result<()> {
    let first = entry(0, 1_700_000_000)?;
    assert_eq!(publish(word(0, 0, 0, 0)?, first).await?, Some(first));
    let resolved = entry(1_777_045_455_067, 1_777_045_500)?;
    assert_eq!(publish(first, resolved).await?, Some(resolved));
    let later = entry(1_777_045_455_067, 1_777_999_999)?;
    assert_eq!(publish(resolved, later).await?, Some(later));
    Ok(())
}

#[tokio::test]
async fn value_is_write_once_and_observed_at_never_goes_back() -> anyhow::Result<()> {
    let resolved = entry(1_777_045_455_067, 1_777_045_500)?;
    assert_eq!(publish(resolved, entry(1_777_000_000_000, 1_777_045_600)?).await?, None, "value change rejected");
    assert_eq!(publish(resolved, entry(0, 1_777_045_600)?).await?, None, "value reset rejected");
    assert_eq!(publish(resolved, entry(1_777_045_455_067, 1_777_045_400)?).await?, None, "backwards heartbeat rejected");
    Ok(())
}
