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
- [x] 5. Web app (2026-09-25) → Winamp-styled player, playlist, my bets, admin panel; guest wallet
      bet placed from the browser, relayed, opened by the operator batch, totals and position state
      updated on screen. Bread path written, not exercised (extension cannot be automated)
- [x] 6. First testable version → three live markets, operator loop, README "Try it"
- [x] 7. Second round (2026-09-25) → connect chooser (Bread recommended / guest), red SAVE moving
      guest MIDEN to Bread, "prediction" wording everywhere, full question on the display, ticker with
      batch countdown + time to resolution, shaded windows, prediction details with withdraw (verified
      in Chrome: predict YES 1 then withdraw, row gone, note never opened), pots with their own
      question / X account / regex and feed key, operator server (API + schedule) driving the admin view
- [x] 9. Bread fix + UI round (2026-09-25) → Gaylord's first Bread prediction failed at the Guardian
      step (multisig needs a declared fee conversion salt): stake requests for Bread now carry one.
      Connect dialog BREAD / GUEST, close crosses top left, batch countdown in prediction details,
      operator opens a batch early once 5 predictions wait, pots carry short titles
- [x] 10. Bread predict verified by Gaylord (2026-09-25, NO 8 MIDEN on the Oct 28 pot): the salt fix
      holds, Bread delivers the note itself, the app's own relay was a rejected duplicate and it ran
      before the position was saved (fixed: no relay for Bread, save first)
- [x] 11. Guest upkeep + forwarding (2026-09-25): the app runs the browser's guest wallet (opens P2ID
      notes every minute, never a stake note) and forwards its receipts to Bread whenever Bread is the
      connected wallet; SAVE moves the balance right away. Topics: pots and predictions group by the
      question stem, staked totals per topic; second topic live (zkGaylord "something stupid",
      Sep 27 / Sep 30 pots). The pot's claim binds the
      payout target to the staker, so re-routing on chain is impossible without a new pot version
      (a stake note could name a payout account). Skins: lcd / classic / modern, iK logo cycles.
- [x] 12. Deployed (2026-09-25) at https://iknow-xi.vercel.app; guest freeze fixed (client in the SDK
      worker, faucet PoW in a worker with a sync SHA-256); play/pause + prev/next; three skins; topics
- [x] 13. Automatic resolution (2026-09-25): operator watches each topic's X profile every 2 min
      (syndication timeline, no key), publishes the earliest qualifying post since the topic's first
      pot, settles due pots and pays out at every 10-minute mark; admin view gated to ADMINS wallets;
      fixed an interval leak that multiplied the early-batch checks every 10 minutes
- [x] 14. First hands-free resolution on testnet (2026-09-25 16:34 → 17:00 UTC): post found by the
      watcher through the X API, oracle published, both zkGaylord pots settled YES and paid on the
      10-minute ticks; payout relay bug (AccountId ctor) found and fixed, notes resent with pot relay
- [ ] 8. Next: Bread withdraw and SAVE with a real user (SAVE now exercises the forwarding path),
      recover-from-chain for positions the app lost, pending-prediction chain check in the details,
      hosting the operator somewhere that does not sleep, Pragma feed instead of the mock oracle,
      a "resolved" section or fade for settled pots in the topics window, a real X post test from a
      personal account (create a pot with that account id + regex in Admin, then "resolve from post"),
      payout receipt in the app after a settlement, hosting, mobile pass (Safari/WKWebView wasm path fixed 2026-09-26; next: open it in Bread's Explore tab, check the layout at phone width),
      stake-after-lock test

## Review (Phase 0)

Five parallel research agents, every claim tied to a source in section 12 of the study. Design revised
twice during review: two-party matched bets dropped because the first markets will be lopsided; Miden
Assembly dropped because the pot design only needs patterns the compiler already ships (verified: p2ide
example, miden-bank deposit note, docs.rs hash_elements and execute_foreign_procedure). Open spikes:
dual-context Rust note script, batch proving time. Open Pragma question: an event feed.
