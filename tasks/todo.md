# iknow: private prediction market on Miden

## Phase 0: feasibility study (2026-09-24) DONE

- [x] Research @miden-sdk/miden-sdk (0.16.3, API surface, private notes, FPI, storage reads)
- [x] Research 0xMiden/agentic-template (v0.16 pins, Rust compiler limits, MockChain harness, frontend)
- [x] Research Miden primitives (accounts, notes, note scripts, block timestamp, FPI, privacy limits)
- [x] Research Pragma (deployed on testnet 0.16, prices only, live read confirmed, questions list)
- [x] Research X-post resolution (snowflake ms, edits, pay-per-use API, syndication, zkTLS)
- [x] Decide market format: binary before-D, peer to peer fixed odds, ladder of dates
- [x] Decide architecture: three MASM scripts, Rust MockChain tests, Node oracle CLI, React app
- [x] Write docs/feasibility.md
- [x] Commit and push to github.com/guelowrd/iknow

## Phase 1 to 6: implementation (see docs/feasibility.md section 10)

- [ ] 1. Scaffold + FPI spike → verify: one MockChain test claims a note only when the foreign entry is set
- [ ] 2. oracle.masm + Node CLI → verify: deployed on testnet, `oracle read` shows the entry, rules self-check passes
- [ ] 3. bet.masm → verify: five MockChain tests (YES, NO via heartbeat, pending fails, refund, wrong claimant)
- [ ] 4. offer.masm → verify: fill, cancel, underfunded taker, plus one end to end
- [ ] 5. web app → verify: vitest note building, two-browser testnet run
- [ ] 6. testnet end to end + README runbook → verify: recorded run with note and tx ids

## Review (Phase 0)

Five parallel research agents, every claim tied to a source in section 12 of the study. Two items are
flagged as proofs of concept (FPI from a note script inside MockChain, SWAP-style offer creating the bet
note) and one as a Pragma conversation (event feed). Local precedents found and reused as references:
`~/Code/miden-10-block-pot` (pool account, client 0.12), `~/Code/miden-day-bet_old` (scaffold only).
