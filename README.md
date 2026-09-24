# iknow

Private prediction market on Miden. First markets: when will @0xMiden post "Partner Mainnet starts now" on X.

Status (2026-09-24): feasibility study done, implementation next. Read [docs/feasibility.md](docs/feasibility.md).

Design in one paragraph: a maker posts a public offer note ("I stake A on YES before date D, want B against
it"). A taker fills it, which locks A+B into a private bet note. When the oracle account publishes the post
timestamp (or a heartbeat past D with no post), the winner consumes the bet note. The oracle is a mock with
the same read interface as Pragma's Miden publisher, so switching to Pragma is a change of note inputs.

Planned layout:

```
masm/     oracle.masm (account component), offer.masm and bet.masm (note scripts)
tests/    Rust MockChain tests (miden-testing 0.16)
oracle/   Node CLI: deploy, heartbeat, resolve, read, rules self-check
web/      React app from 0xMiden/frontend-template v0.16
docs/     feasibility study and runbooks
tasks/    plan and progress
```
