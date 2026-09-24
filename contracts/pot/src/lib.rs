//! One pari-mutuel pot per market. Per-side totals are public; positions are hash commitments.
//!
//! Storage words: `market = [deadline_ms, lock_height, grace_s, unit]`, `oracle = [prefix, suffix, 0, 0]`,
//! `totals = [yes_units, no_units, 0, 0]`, `outcome = 0 pending | 1 yes | 2 no | 3 void`,
//! `positions[hash(target, side, units, salt)] = 1 open | 2 claimed`.
#![no_std]
#![feature(alloc_error_handler)]

extern crate alloc;
use alloc::vec;

use miden::*;

const YES: u64 = 1;
const NO: u64 = 2;
const VOID: u64 = 3;
// ponytail: units and totals stay below 2^32 so `units * total` fits u64; u128 if a pot ever needs it.
const MAX_UNITS: u64 = 1 << 32;

#[component_storage]
struct PotStorage {
    #[storage(description = "[deadline_ms, lock_height, grace_s, unit]")]
    market: StorageValue<Word>,
    #[storage(description = "asset id word of the staking asset")]
    asset_id: StorageValue<Word>,
    #[storage(description = "oracle account [prefix, suffix, 0, 0]")]
    oracle: StorageValue<Word>,
    #[storage(description = "oracle get_entry procedure root")]
    oracle_root: StorageValue<Word>,
    #[storage(description = "oracle feed key")]
    feed_key: StorageValue<Word>,
    #[storage(description = "P2ID note script root used for payouts")]
    p2id_root: StorageValue<Word>,
    #[storage(description = "[yes_units, no_units, 0, 0]")]
    totals: StorageValue<Word>,
    #[storage(description = "0 pending, 1 yes, 2 no, 3 void")]
    outcome: StorageValue<Felt>,
    #[storage(description = "position commitment -> 1 open, 2 claimed")]
    positions: StorageMap<Word, Felt>,
}

#[component]
trait Pot {
    /// Called by a stake note consumed by the pot. Reads the active note itself
    /// (sender = payout target, storage = [pot_prefix, pot_suffix, side, salt], one asset).
    #[account_procedure]
    fn stake(&mut self);
    /// Reads the oracle feed through FPI and fixes the outcome. Panics while pending.
    #[account_procedure]
    fn settle(&mut self);
    /// Called by a claim note: verifies the position and pays the target through a private P2ID note.
    #[account_procedure]
    fn claim(&mut self, target: AccountId, side: Felt, units: Felt, salt: Word, tag: Felt);
}

fn position_key(target: AccountId, side: Felt, units: u64, salt: Word) -> Word {
    let s = salt.into_elements();
    Word::from(hash_elements(vec![
        target.prefix,
        target.suffix,
        side,
        Felt::new_unchecked(units),
        s[0],
        s[1],
        s[2],
        s[3],
    ]))
}

#[component]
impl Pot for PotStorage {
    fn stake(&mut self) {
        assert!(self.outcome.get().as_canonical_u64() == 0);
        let m = self.market.get().into_elements();
        let lock_height = BlockNumber::try_from(m[1]).unwrap();
        assert!(tx::get_block_number() < lock_height);

        let storage = active_note::get_storage();
        assert!(storage.len() == 7);
        let side = storage[2];
        let salt = Word::from([storage[3], storage[4], storage[5], storage[6]]);
        let target = active_note::get_sender();
        let assets = active_note::get_initial_assets();
        assert!(assets.len() == 1);
        let asset = assets[0];
        assert!(asset.key == self.asset_id.get());

        let unit = m[3].as_canonical_u64();
        let amount = asset.value.into_elements()[0].as_canonical_u64();
        assert!(unit > 0 && amount % unit == 0);
        let units = amount / unit;
        assert!(units > 0 && units < MAX_UNITS);

        let s = side.as_canonical_u64();
        assert!(s == YES || s == NO);
        let mut t = self.totals.get().into_elements();
        let idx = (s - 1) as usize;
        let new_total = t[idx].as_canonical_u64() + units;
        assert!(new_total < MAX_UNITS);
        t[idx] = Felt::new_unchecked(new_total);
        self.totals.set(Word::from(t));

        // Hash and record the position before touching the vault: hashing after `add_asset`
        // panics in the SDK's executor (observed on testnet and in the mock client, not in
        // miden-testing). The transaction reverts as a whole either way.
        let key = position_key(target, side, units, salt);
        assert!(self.positions.get(key).as_canonical_u64() == 0);
        self.positions.set(key, felt!(1));
        self.add_asset(asset);
    }

    fn settle(&mut self) {
        assert!(self.outcome.get().as_canonical_u64() == 0);
        let m = self.market.get().into_elements();
        let deadline_ms = m[0].as_canonical_u64();
        let grace_ms = m[2].as_canonical_u64() * 1000;
        let o = self.oracle.get().into_elements();
        let k = self.feed_key.get().into_elements();
        // Words cross the FPI boundary reversed in both directions: pass the key as [k3, k2, k1, k0]
        // and read the returned entry with get(0) = element 3 ... get(3) = element 0.
        let out = tx::execute_foreign_procedure(
            AccountId::new(o[0], o[1]),
            self.oracle_root.get(),
            tx::ForeignProcedureInputs::new([k[3], k[2], k[1], k[0]]),
        );
        let value_ms = out.get(2).as_canonical_u64();
        let observed_ms = out.get(0).as_canonical_u64() * 1000;
        let now_ms = (tx::get_block_timestamp() as u64) * 1000;

        let outcome = if value_ms != 0 {
            if value_ms < deadline_ms { YES } else { NO }
        } else if observed_ms >= deadline_ms && now_ms >= deadline_ms {
            NO
        } else if now_ms >= deadline_ms + grace_ms {
            VOID
        } else {
            panic!()
        };
        self.outcome.set(Felt::new_unchecked(outcome));
    }

    fn claim(&mut self, target: AccountId, side: Felt, units: Felt, salt: Word, tag: Felt) {
        let outcome = self.outcome.get().as_canonical_u64();
        assert!(outcome != 0);
        let u = units.as_canonical_u64();
        let key = position_key(target, side, u, salt);
        assert!(self.positions.get(key).as_canonical_u64() == 1);
        self.positions.set(key, felt!(2));

        let payout_units = if outcome == VOID {
            u
        } else {
            assert!(side.as_canonical_u64() == outcome);
            let t = self.totals.get().into_elements();
            let total = t[0].as_canonical_u64() + t[1].as_canonical_u64();
            let winning = t[(outcome - 1) as usize].as_canonical_u64();
            u * total / winning
        };
        let unit = self.market.get().into_elements()[3].as_canonical_u64();
        let amount = Word::from([Felt::new_unchecked(payout_units * unit), felt!(0), felt!(0), felt!(0)]);
        let asset = Asset::new(self.asset_id.get(), amount);

        let k = key.into_elements();
        let serial = Word::from(hash_elements(vec![k[0], k[1], k[2], k[3], felt!(1)]));
        let recipient = note::build_recipient(serial, self.p2id_root.get(), vec![target.suffix, target.prefix]);
        let idx = output_note::create(Tag::from(tag), NoteType::from(felt!(0)), recipient);
        self.remove_asset(asset);
        output_note::add_asset(asset, idx);
    }
}
