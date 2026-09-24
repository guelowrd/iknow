# iknow

Private prediction market on Miden. First markets: when will @0xMiden post "Partner Mainnet starts now" on X.

Status (2026-09-25): spec in [docs/feasibility.md](docs/feasibility.md). Contracts, 13 MockChain tests
and the operator CLI are done, and a full cycle ran on Miden testnet v0.16 (see "Testnet run" below).
Remaining: the web app (user and admin views), tracked in [tasks/todo.md](tasks/todo.md).

Design in one paragraph: one pari-mutuel pot per market date. Bettors send private stake notes to the pot;
the pot opens them in daily batches, so per-side totals are public and verifiable on chain while individual
bets stay hidden behind hash commitments. When the oracle account publishes the post timestamp (or a
heartbeat past the date with no post), the pot settles and pays winners pro rata through private notes.
The oracle is a mock with the same read interface as Pragma's Miden publisher, so switching to Pragma is a
config change on new pots.

## Layout

```
contracts/oracle          Rust account component: feed entries, Pragma-compatible layout
contracts/pot             Rust account component: stake / settle / claim
contracts/stake-note.masm Miden Assembly note: pot path calls stake, sender path takes the stake back
contracts/claim-note      Rust note: calls claim with the position tuple
contracts/settle-script   Rust transaction script: calls settle
integration/              Rust MockChain tests (miden-testing 0.16)
operator/                 Node CLI on the Miden SDK: oracle, pots, bets, batches, settle, payout
web/                      React app, user and admin views (next phase)
```

## Toolchain

Pinned by `rust-toolchain.toml` (nightly-2026-09-01, wasm32-wasip2) and `miden-toolchain.toml` (0.16.0).

```
cargo install --locked midenup && midenup init && midenup install 0.16.0
```

midenup 1.0 puts the toolchain under `$(midenup show home)/publications/0.16.0-*/bin` and installs no
shim, so point the tests at it:

```
export CARGO_MIDEN="$(midenup show home)/publications/0.16.0-02832cce48a59e5d/bin/cargo-miden"
cd integration && cargo test --release
```

Build one contract by hand: `cd contracts/pot && "$(dirname "$CARGO_MIDEN")/cargo-miden" miden build --release`.

## Notes for the next phases

- Compiled packages export procedures as `::"miden:pot/pot@0.1.0"::stake`; `helpers::procedure_root`
  finds a root by short name.
- The guest SDK's `hash_elements` is Poseidon2 (docs say RPO). Client side: `miden_client::crypto::Poseidon2`.
- A Rust note cannot call the standard `BasicWallet` (different procedure roots), which is why the stake
  note is assembly. Everything that only talks to our own components stays Rust.
- Account procedures can read the active note (`active_note::get_sender/get_storage/get_initial_assets`),
  so `stake()` takes no arguments and the assembly note needs no argument marshalling.
- Words cross the FPI boundary reversed in both directions: pass a key as `[k3, k2, k1, k0]` and read
  a returned `[0, value, 0, observed_at]` as `get(2)` and `get(0)`.
- Inline assembly transaction scripts on 0.16 are a module with `@transaction_script pub proc main`,
  compiled by `CodeBuilder::compile_tx_script` with the callee package linked dynamically. Calls into a
  compiled component take their arguments first-parameter-on-top: `push.e3.e2.e1.e0.k3.k2.k1.k0` for
  `publish_entry(key, entry)`, padded to 16 with `padw padw` below and dropped after.

## Operator CLI

```
cd operator && npm install && npm test          # rules self-check
node cli.mjs oracle deploy                      # public oracle account, funded from the faucet
node cli.mjs oracle heartbeat                   # [0, value, 0, now]: makes NO claimable after the date
node cli.mjs oracle resolve --post-id <id>      # fetches the X post, applies the rules, publishes the timestamp
node cli.mjs pot deploy --deadline 2026-12-31T23:59:59Z [--lock-height N] [--grace-days 30] [--unit 1000000]
node cli.mjs wallet new                         # a funded test bettor
node cli.mjs bet --wallet <id> --pot <id> --side yes|no --units 3
node cli.mjs pot inbox|batch|status|settle|payout --pot <id>
node cli.mjs wallet claim --wallet <id>         # winner consumes the payout note
IKNOW_MOCK=1 node mock-cycle.mjs                # the same commands end to end on the SDK's mock chain
```

State (account ids, positions learned from opened notes) lives in `operator/state.json`; raw X responses
in `operator/evidence/`. Contracts are read from `contracts/*/target/miden/release`, so build them first.

## Testnet run (2026-09-25, Miden testnet v0.16)

| Item | Id |
|---|---|
| Oracle | `0x54133848adb3ec113228cd45041fab` |
| Pot (deadline 2026-12-31T23:59:59Z, lock height 446496) | `0x537281b405d2c151563f4b72119871` |
| YES stake, 3 tokens | note `0x8a815d13…b1f8`, tx `0x1e165c55…6e70` |
| NO stake, 1 token | note `0xeff48110…7dfe`, tx `0xd5c01723…1b55` |
| Batches | `0xe5e3e37d…8920`, `0x1ada044c…61d6` |
| Oracle publish (value 2026-11-01T00:00Z) | `0x9d3c8557…6803` |
| Settle (outcome YES, totals 3/1) | `0xa7bdc46a…6d25` |
| Payout (winner gets 4 tokens) | `0x87ef4bc3…1748` |

## SDK gotchas met on the way

- Keep felts as BigInt: converting a `u64` through a JS number rounded the asset id word and the
  oracle root before they were seeded, and `stake` rejected every note.
- Hash the position commitment before `add_asset`: hashing after it panics in the SDK's executor
  (testnet and mock client) but not in `miden-testing`.
- `AccountComponent.getProcedureHash` wants the quoted kebab name: `"get-entry"`.
- `NoteTag.withAccountTarget` encodes only part of the id: faucet P2ID notes to other accounts can share
  the pot's tag, so batches select notes by script as well.
- On the Node build pass plain arrays where the browser build takes `FeltArray` / `NoteArray` /
  `StorageSlotArray`, and `client._withInnerWebClient` is unavailable: build contracts with
  `AccountBuilder` and register them with `accounts.insert` plus `keystore.insert`.
- `accounts.create` for contracts does not add BasicWallet; the pot and oracle need it to consume
  faucet notes for fees.
- Enable `noteTransportUrl` explicitly on the client, or private note relay throws.
