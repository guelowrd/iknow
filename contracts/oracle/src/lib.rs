//! Feed oracle. Same entry layout as Pragma's Miden publisher so a pot can point at either:
//! `entries[key] = [0, value, 0, observed_at]`. `value` is write-once, `observed_at` only grows.
#![no_std]
#![feature(alloc_error_handler)]

use miden::{component, component_storage, StorageMap, Word};

#[component_storage]
struct OracleStorage {
    #[storage(description = "feed key -> [0, value, 0, observed_at]")]
    entries: StorageMap<Word, Word>,
}

#[component]
trait Oracle {
    /// Publish an entry. Rejects a change of a non-zero value or a backwards observed_at.
    #[account_procedure]
    fn publish_entry(&mut self, key: Word, entry: Word);
    /// Read an entry. Called by pots through foreign procedure invocation.
    #[account_procedure]
    fn get_entry(&self, key: Word) -> Word;
}

#[component]
impl Oracle for OracleStorage {
    fn publish_entry(&mut self, key: Word, entry: Word) {
        let cur = self.entries.get(key).into_elements();
        let new = entry.into_elements();
        let cur_value = cur[1].as_canonical_u64();
        assert!(cur_value == 0 || cur_value == new[1].as_canonical_u64());
        assert!(new[3].as_canonical_u64() >= cur[3].as_canonical_u64());
        self.entries.set(key, entry);
    }

    fn get_entry(&self, key: Word) -> Word {
        self.entries.get(key)
    }
}
