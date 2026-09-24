//! Claim note, consumed by the pot: pays the position's target if it won (or refunds on VOID).
//! Storage: [target_prefix, target_suffix, side, units, salt0..salt3, tag].
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

#[account(pot::Pot)]
pub struct PotAccount;

#[note]
struct ClaimNote {
    target_prefix: Felt,
    target_suffix: Felt,
    side: Felt,
    units: Felt,
    salt0: Felt,
    salt1: Felt,
    salt2: Felt,
    salt3: Felt,
    tag: Felt,
}

#[note]
impl ClaimNote {
    #[note_script]
    fn run(self, _arg: Word, account: &mut PotAccount) {
        let target = AccountId::new(self.target_prefix, self.target_suffix);
        let salt = Word::from([self.salt0, self.salt1, self.salt2, self.salt3]);
        account.claim(target, self.side, self.units, salt, self.tag);
    }
}
