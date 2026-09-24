//! Spike: consumed by the pot, asks it to dump its oracle FPI read into storage.
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

#[account(pot::Pot)]
pub struct PotAccount;

#[note]
struct FpiProbe;

#[note]
impl FpiProbe {
    #[note_script]
    fn run(self, _arg: Word, account: &mut PotAccount) {
        account.debug_fpi();
    }
}
