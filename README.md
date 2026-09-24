# iknow

Private prediction market on Miden. First markets: when will @0xMiden post "Partner Mainnet starts now" on X.

Status (2026-09-24): spec in [docs/feasibility.md](docs/feasibility.md), phase 1 done (contracts compile,
spikes pass), phases 2 to 6 tracked in [tasks/todo.md](tasks/todo.md).

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
contracts/fpi-probe       Rust note used by the FPI spike test only
integration/              Rust MockChain tests (miden-testing 0.16)
operator/                 Node CLI on the Miden SDK (phase 2)
web/                      React app, user and admin views (phase 5)
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
- A `Word` returned through FPI arrives reversed in `ForeignProcedureOutputs`: `get(0)` is element 3,
  `get(3)` is element 0. For an oracle entry `[0, value, 0, observed_at]` read `get(2)` and `get(0)`.
