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

- [x] 1. Scaffold + spikes (2026-09-24) → FPI read from a note passes; dual-context note is MASM
      (Rust cannot call the standard wallet); 30-note batch executes in ~150 ms in MockChain; Poseidon2
      commitments verified on chain
- [x] 2. Oracle contract + operator oracle commands (2026-09-25) → deployed on testnet as
      0x54133848adb3ec113228cd45041fab, heartbeat and value published and read back, rules self-check passes
- [x] 3. Pot + stake note + claim note + settle script (2026-09-24) → 13 MockChain tests: batch totals
      and commitments, reclaim, oracle write-once and heartbeat, settle YES / NO / pending / VOID,
      pro-rata claims, loser / wrong tuple / double / early claims fail, operator claims on behalf,
      VOID refunds. Not yet covered: stake after lock height (needs a block-number gate test)
- [x] 4. Operator CLI + testnet (2026-09-25) → full cycle on testnet with two bettor wallets: bets,
      two batches, settle YES through FPI, payout, claim (ids in README). Same cycle runs on the SDK
      mock chain with IKNOW_MOCK=1
- [ ] 5. Web app (user + admin) → verify: vitest on note building, two-browser testnet run
- [ ] 6. End to end + README runbook → verify: recorded run with account, note and transaction ids

## Review (Phase 0)

Five parallel research agents, every claim tied to a source in section 12 of the study. Design revised
twice during review: two-party matched bets dropped because the first markets will be lopsided; Miden
Assembly dropped because the pot design only needs patterns the compiler already ships (verified: p2ide
example, miden-bank deposit note, docs.rs hash_elements and execute_foreign_procedure). Open spikes:
dual-context Rust note script, batch proving time. Open Pragma question: an event feed.
