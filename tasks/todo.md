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

## UI/UX iteration 2 (2026-09-26): resolved window, prediction states, payout ledger

- [x] operator: record the resolving post (id, handle, time) on resolve, settledAt on settle, payout note/tx/time per position on payout; markets.json carries settledAt, resolvedAt, post, payouts (keyed by position commitment) → verify: markets.json for the two settled pots after backfill
- [x] operator: republish markets.json (git commit + push, IKNOW_PUBLISH=1) after a settlement → verify: dry run of the publish step
- [x] app: "Resolved predictions" window, shaded by default, grouped by topic, outcome first and colored, pool and multiple; resolved pots leave the topics window → verify: screenshot
- [x] app: display result mode for a settled pot (outcome, pool, multiple, evidence link, no batch countdown) → verify: screenshot
- [x] app: My predictions rows with state LED and net story, live topics first, colored state column, per-topic summary, payout ledger lines, refunds, payout notice → verify: screenshot with the lost position; won/paid rendering by code review
- [x] README + memory

## Operator fixes (2026-09-28)

- [x] pot deploy: handle → id through the X API (users/by/username) or an earlier pot, not the syndication widget (429) → verify: both paths return 1811045655449899008 for zkGaylord; pot 0xa41eca47 created from the admin view
- [x] batch: only notes with the stake script root are stakes; tag collisions (P2IDE notes for other accounts sharing the pot's top id bits) blocked every batch on 0x98a2 and 0xa41e → verify: forced batches on both pots say "nothing to open"; compiled root 0xbfc0b5c0 matches the real stake notes in the store
- [ ] wallet 0x31fa43034e4eb1c139078ade36955f sent four plain P2IDE payments (8, 5, 55, 55 MIDEN, Sep 26) to the Oct 20 pot; the old batch consumed them into the vault and recorded bogus positions (side = pot suffix). Decide: refund from the pot, and drop the four entries from state.json
- [x] pot deploy refuses a deadline that is not in the future (a pot made from the admin view with the year typed as 2016 settled NO at the next tick); the create button stays off for such a date → verify: `pot deploy --deadline 2016-09-29T23:59:00Z` throws "not in the future"; pot 0x2a6975c8 ("before Sep 29, 2016") hidden

## Since bound + hide (2026-09-28)

- [x] operator: feed key = sha256(account | pattern | createdMs); resolve rejects posts before the pot's creation → verify: keys differ per creation time; resolve check offline against the Sep 25 post
- [x] operator: `pot hide --pot --hidden 1|0`, POST /hide, markets.json `hidden`, auto-publish → verify: hide the test pot through the API, markets.json shows hidden true, commit pushed
- [x] app: hidden pots left out of the windows and of My predictions; admin row gets hide/unhide for resolved pots → verify: build passes; Resolved window on localhost without the test pot
- [x] README

## Stability and security program (2026-09-29): one commit and push per layer

- [x] 1. admin API guard: 403 unless the Host is loopback, the Origin (when sent) is allowed, and a POST carries JSON; admin.test.mjs spawns the server on the mock chain → verify: node --test green; curl on the live server with a foreign Origin gets 403; the admin view still loads
- [x] 1b. admin buttons heartbeat, watch X, settle due send no body, so they go out as GET and hit no route → verify: POST with {} from the view; curl GET /heartbeat was 404 before
- [x] 2. operator suite: cycle.test.mjs replaces mock-cycle.mjs (already broken: oracle publish needs --pot) and asserts deploy refusals, batch, a plain P2IDE payment not taken as a stake, YES payout pro rata and once, no settle while pending (VOID and NO by heartbeat need a block clock the JS mock lacks: the Rust tests cover them); rules.test.mjs fuzzes evaluate with fast-check; pot deploy rejects an invalid regex → verify: npm test 14/14; the fuzz found three crashes in evaluate (missing id, non-string text, id object with its own toString), 600k posts clean after the fix
- [x] 2a. INCIDENT 12:20 UTC: the first cycle run wrote mock pots into web/public/markets.json and the operator published them (a80b174); restored from state.json in a5e9e0e at 12:22, mock mode now writes operator/markets.mock.json
- [x] 3. contracts: pot_props.rs, proptest over random stake sets (1 to 8 stakes, YES or NO, every winner claims: floor(units x total / winning) each, never above the vault, dust below one unit per winner), stake refused one unit past the side cap and at the lock height → verify: cargo test 15 passed, 1 ignored; PROPTEST_CASES=100 run
- [ ] 3a. DECIDE, contract bug: claim computes units x total in u64 and wraps once both sides near 2^32 units (winner paid 4294967289 units instead of 8589934588, test claim_math_holds_with_both_sides_near_the_cap, ignored). Unreachable on live pots (1 MIDEN units, ~3e9 MIDEN a side needed) but reachable at 3000 MIDEN with --unit 1. Fix: u128 in claim; changes the claim procedure root, so payouts of deployed pots need the old claim-note package kept per pot version (stake root unchanged, web unaffected)
- [ ] 3b. DECIDE, product: a winning side nobody backed leaves every stake in the pot for good (docs cover only the mirror case, nobody on NO). Pari-mutuel usually refunds: settle VOID when the winning side is empty; also a settle code change
- [x] 4. web: vitest + fast-check (iknow.test.ts): any stored content loads as a list every reader can use, valid positions all survive in order (hex guests and suffixed Bread addresses), payout preview equals the pot formula, odds and countdowns in range → verify: 5/5; on the old code a stored {} came back as a non-array (every caller crashes, blank app) and the preview showed one unit too many past 2^53; build passes
- [ ] 5. CI: GitHub Actions for operator, web, contracts and npm audit; the Vercel build runs the web tests first → verify: the run on the push is green; the Vercel deploy succeeds
