//! Transaction script run by the operator on the pot: settles from the oracle feed.
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

#[account(pot::Pot)]
pub struct PotAccount;

#[tx_script]
fn run(_arg: Word, account: &mut PotAccount) {
    account.settle();
}
