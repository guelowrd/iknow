# iknow

Private prediction market on Miden. First markets: when will @0xMiden post "Partner Mainnet starts now" on X.

Status (2026-09-24): feasibility study done, implementation next. Read [docs/feasibility.md](docs/feasibility.md).

Design in one paragraph: one pari-mutuel pot per market date. Bettors send private stake notes to the pot;
the pot opens them in daily batches, so per-side totals are public and verifiable on chain while individual
bets stay hidden behind hash commitments. When the oracle account publishes the post timestamp (or a
heartbeat past the date with no post), the pot settles and pays winners pro rata through private notes.
The oracle is a mock with the same read interface as Pragma's Miden publisher, so switching to Pragma is a
config change on new pots.

Planned layout:

```
contracts/   Rust (Miden compiler): oracle, pot, stake-note, claim-note, settle-script
integration/ Rust MockChain tests (miden-testing 0.16)
operator/    Node CLI on the Miden SDK: oracle, pot deploy, inbox, batch, settle, payout, status
web/         React app (user and admin views), later phase
docs/        feasibility study and runbooks
tasks/       plan and progress
```
