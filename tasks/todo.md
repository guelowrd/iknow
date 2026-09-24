# iknow: private prediction market on Miden

## Phase 0: feasibility study (2026-09-24) DONE

- [x] Research SDK, agentic-template, Miden primitives, Pragma, X-post resolution
- [x] Decide market format: binary before-D, one pari-mutuel pot per ladder date, public totals
- [x] Decide architecture: Rust contracts (oracle, pot, stake note, claim note, settle script),
      MockChain tests, Node operator CLI, React app later
- [x] Write docs/feasibility.md (revised after review: pot instead of two-party bets, Rust instead of MASM)
- [x] Sync local Miden clones from their remotes (agentic-template now on v0.16 templates)
- [x] Commit and push to github.com/guelowrd/iknow

## Phase 1 to 6: implementation (details in docs/feasibility.md section 10)

- [ ] 1. Scaffold + spikes → verify: MockChain tests for raw FPI from a Rust account proc, dual-context
      Rust note (else MASM), 30-note batch with proving time recorded, hash_elements round trip
- [ ] 2. Oracle contract + operator oracle commands → verify: deployed on testnet, `oracle read` shows
      the entry, `node operator/rules.mjs` self-check passes
- [ ] 3. Pot + stake note + claim note + settle script → verify: batch totals and commitments, reclaim,
      stake after lock fails, settle YES / NO / pending / VOID, claim math incl. lopsided pot, double
      claim fails, wrong tuple fails
- [ ] 4. Operator CLI + testnet → verify: full cycle from the CLI with two bettor wallets
- [ ] 5. Web app (user + admin) → verify: vitest on note building, two-browser testnet run
- [ ] 6. End to end + README runbook → verify: recorded run with account, note and transaction ids

## Review (Phase 0)

Five parallel research agents, every claim tied to a source in section 12 of the study. Design revised
twice during review: two-party matched bets dropped because the first markets will be lopsided; Miden
Assembly dropped because the pot design only needs patterns the compiler already ships (verified: p2ide
example, miden-bank deposit note, docs.rs hash_elements and execute_foreign_procedure). Open spikes:
dual-context Rust note script, batch proving time. Open Pragma question: an event feed.
