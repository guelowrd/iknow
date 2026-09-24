# iknow: a private prediction market on Miden

Feasibility study and implementation spec. Written 2026-09-24 against Miden testnet v0.16, revised the
same day after design review (pool with public totals instead of two-party bets, Rust instead of Miden
Assembly). Every technical claim was checked against current sources on that date (section 12).
Labels: **[VERIFIED]** checked in source or live, **[POC]** needs a proof of concept before I rely on it,
**[ASK PRAGMA]** needs a conversation with the Pragma team.

## 1. Verdict

Feasible now, on testnet v0.16, with `@miden-sdk/miden-sdk` 0.16.3 and contracts written in Rust through
the Miden compiler on the v0.16 agentic template. No protocol feature is missing. The design is a
pari-mutuel pot per market: a public account whose per-side totals anyone can read on chain, fed by private
stake notes that the pot opens in batches, with positions stored as hash commitments so no individual bet
ever appears in the clear. Payouts are enforced by the pot's code, so the operator can run the market but
cannot misallocate it.

Pragma is a real option: it is deployed on Miden testnet v0.16 and I read a live BTC/USD entry from it
during this study. It publishes prices only. Resolving an X post needs a custom feed from them, which their
docs explicitly invite for prediction markets. The MVP mocks that feed with an oracle account that exposes
the same read interface, so switching later is a change of three storage values in the pot.

Spikes before I trust the plan: a Rust account procedure calling a foreign `get_entry` through FPI inside
the MockChain harness, a Rust note script that behaves differently in the pot's context and in the
bettor's wallet (Miden Assembly fallback if the macro cannot express it), and one batch transaction opening
a few dozen stake notes. Proving time is a secondary concern: batches run on a daily cadence.

## 2. Market format: binary "before D", one pari-mutuel pot per market

Each market answers one question: will @0xMiden post "Partner Mainnet starts now" before instant D (UTC)?
YES wins if the post timestamp is earlier than D. NO wins otherwise, including if nothing has been posted
when D arrives. A short ladder of D values (for example 2026-12-31, 2027-03-31, 2027-06-30) is one pot each.

Why this format:

- Two outcomes, one comparison. The settlement rule is `post_ts < D`.
- It resolves as early as possible. YES the moment the post lands, NO the moment the oracle heartbeat
  passes D with no post. No separate "never" outcome.
- A ladder of binaries expresses date buckets. YES on D2 plus NO on D1 is a bet on the (D1, D2) bucket.
- The oracle interface is a numeric feed (announcement timestamp, zero until it exists, plus observation
  time), which is the shape of a Pragma price entry.

Why pari-mutuel instead of matched bets: the first markets will be lopsided. A pot needs no counterparty.
Ten people on YES at 10 each and one on NO at 5 make a pot of 105. If YES wins each YES bettor gets 10.5.
If NO wins the NO bettor gets 105. If nobody bets NO, YES bettors get their stakes back. Polymarket is an
order book with market makers and every trade is public; Kalshi is the same model under regulation. What
people know from Polymarket is the public "how much on each side" number, and the pot gives exactly that.
Fixed-price bets (buy YES at 60 cents) can come later as a house market maker on top of the same pot.

Formats rejected: date buckets in one pot (N-way settlement, resolves only when the last bucket closes),
exact date (a raffle), two-party matched bets (my first draft; needs symmetric demand).

## 3. Resolution rules for the X post

The oracle (mock now, Pragma later) publishes one entry per feed: `value` = post timestamp in Unix
milliseconds, `0` if no qualifying post exists, and `observed_at` = Unix seconds of the last check.

Minimum rules for an unambiguous result **[VERIFIED against X API v2 docs and a live syndication probe]**:

1. **Author** is the numeric X user id `1468873289267171330` (@0xMiden). Handles can change, ids cannot.
2. **Qualifying post**: an original post, a quote whose own text matches, or a reply inside the account's
   own thread. Reposts of someone else, and quotes of someone else's matching text, do not count.
3. **Text**: `note_tweet.text` when present (long posts), else `text`. Normalize with NFKC, strip URLs,
   collapse whitespace, case-fold. It matches if it contains `partner mainnet starts now` as a contiguous
   substring. Emojis and punctuation around the phrase are ignored.
4. **Timestamp**: the snowflake time of the matching post id, `(id >> 22) + 1288834974657` ms UTC. This is
   millisecond precision; the API's `created_at` is second precision. Both derive from the same id.
5. **Edits**: every edit creates a new post id. The earliest id in the edit history whose text matches is
   the one that counts, with its own snowflake time. An edit that removes the phrase does not unresolve.
6. **Deletion**: resolution is fixed at first observation. The oracle keeps the raw response and its hash.
   A post the oracle never observed before deletion does not exist.
7. **Multiple posts**: the earliest qualifying post wins.
8. **D** is a Unix millisecond instant, stated in UTC in the UI. "Before 2027" means `D = 2027-01-01T00:00Z`.
9. **NO before the post**: `value == 0` and `observed_at >= D` resolves NO. The heartbeat is the negative
   attestation. The pot also requires the block timestamp to be at or past D (section 9 explains why that
   direction of check is sound on Miden).
10. **Unresolved**: if the pot is still pending at `D + grace` (30 days in the MVP), it settles VOID and
    every position claims its own stake back.

Open detail: X's own pages disagree on whether the edit window is 30 or 60 minutes. Rule 5 does not
depend on it.

## 4. What is public, private, revealed

Miden facts that bound this **[VERIFIED]**: note metadata (sender account id, note type, tag) is always
public, even for private notes. Nullifiers are public and cannot be linked back to a note id. A private
account's id and state commitment appear on chain at every update. A public account's storage and vault
are readable by anyone, and every change is enforced by the transaction proof. There is no encrypted note
type on v0.16. The note transport service delivers private note details in plaintext to its server.

| Item | Visibility | Why |
|---|---|---|
| Per-side totals, outcome, market parameters | Public, verifiable | Value slots of the public pot account, changed only by the pot's code |
| Individual stake amount and side | Private | Stake note is a private note; the pot stores only a hash commitment |
| Who bet (account ids that sent a note to the pot) | Public | Note metadata carries the sender id and the pot's tag |
| Per-batch flow | Public | Each batch transaction moves the totals; the delta per side is visible |
| Who won, how much | Private | Payout is a private P2ID note; the pot's vault drops by the batch sum only |
| Number of positions, number of claims | Public | Map entries appear and flip; nullifier count per batch |
| Oracle account, feed value, heartbeat | Public | Read through FPI, must be public |
| Operator view | Everything | The operator opens every stake note and holds every tuple |
| Transport server | Note contents | Plaintext relay; note file exchange avoids it |
| Delegated prover | Everything in a transaction | Local proving by default |

The one structural leak is the batch delta. If the pot opened one stake note per transaction, an observer
would read that bettor's side and amount off the totals. So the pot opens all waiting notes in one
transaction: a batch when at least five notes are waiting, or every 24 hours, whichever comes first. The
observer then sees "YES rose 50, NO rose 20, six accounts sent notes" and cannot attribute amounts. Early
batches will be small and their amounts weakly hidden. Participation itself cannot be hidden on Miden.
This is strictly more private than Polymarket, where every trade is public with its wallet.

A stronger variant, deferred: a private pot account whose totals the operator publishes with Merkle proofs
against the on-chain commitment. Nothing leaks per batch, but the totals live on the website with a proof
instead of on the explorer, and the proof tooling is a spike of its own.

## 5. Architecture and MVP design

Everything on chain is Rust compiled by the Miden compiler, on the v0.16 project template. Everything off
chain is TypeScript on the SDK.

```
contracts/oracle        account component: map `entries`, publish_entry / get_entry (Pragma layout)
contracts/pot           account component: totals, outcome, positions map; stake / settle / claim
contracts/stake-note    note script: in the pot's context calls stake, in the bettor's wallet reclaims
contracts/claim-note    note script: calls claim with the position tuple
contracts/settle-script transaction script: calls settle
integration/            MockChain tests (miden-testing 0.16)
operator/               Node CLI on the SDK: oracle, pot deploy, inbox, batch, settle, payout, status
web/                    React app (user side and admin side), later phase
```

### Why Rust here

The compiler documents itself as experimental, and I would have avoided it for note scripts that create
other notes. The pot design needs none of that. Every piece is a pattern the compiler already ships or the
official tutorial demonstrates **[VERIFIED]**: account components with `StorageValue` and `StorageMap`
(counter template), a note script that reads its own storage, its sender and the consuming account id and
branches on them (`compiler/examples/p2ide-note`), a note script that calls an account procedure with
arguments (`miden-bank` deposit note: `account.deposit(depositor, asset)`), output note creation from an
account procedure (`~/Code/miden-10-block-pot` emits winner notes), RPO hashing (`miden::hash_elements`),
and raw foreign procedure invocation (`tx::execute_foreign_procedure(root, account_id, inputs)` on docs.rs
0.14). The generated Miden Assembly payout script from my first draft is gone: payouts are driven by claim
notes the pot consumes, which is the same code shape as staking.

### Contracts

**oracle** (public account, Falcon single-signature auth held by the operator). Map slot `entries`:
`FEED_KEY -> [0, value, 0, observed_at]`, the same word layout as Pragma's publisher **[VERIFIED in
astraly-labs/pragma-miden publisher.masm]**. `publish_entry(key, entry)`: `value` is write-once,
`observed_at` only moves forward. `get_entry(key) -> Word`: read by the pot through FPI. Write-once matters
because FPI reads the foreign account at the transaction's reference block and that commitment is not a
public input **[VERIFIED in protocol docs]**: a claimant picking an older reference block can only see "not
yet", which fails, never a different outcome.

**pot** (one per market, public account, operator auth). Storage: value slots `market`
(`[deadline_ms, lock_height, grace_s, unit]`), `asset` (faucet id), `oracle` (account id), `oracle_root`
(`get_entry` procedure root), `feed_key`, `totals` (`[yes_units, no_units, 0, 0]`), `outcome`
(0 pending, 1 YES, 2 NO, 3 VOID); map slot `positions` (`commitment -> 1 open, 2 claimed`).

```
stake(target, side, salt, asset)           called by the stake note script
  assert outcome == 0 and tx::get_block_number() < lock_height
  assert asset.faucet == market asset, amount % unit == 0
  units = amount / unit; assert units < 2^32 and totals[side] + units < 2^32
  native_account::add_asset(asset); totals[side] += units
  key = hash_elements([target, side, units, salt]); assert positions[key] == 0; positions[key] = 1

settle()                                   called by the settle transaction script, idempotent
  assert outcome == 0
  ENTRY = tx::execute_foreign_procedure(oracle_root, oracle, feed_key)
  value_ms = ENTRY[1]; observed_at = ENTRY[3]; now = tx::get_block_timestamp()
  if value_ms != 0:                         outcome = value_ms < deadline_ms ? YES : NO
  elif observed_at*1000 >= deadline_ms
       and now*1000 >= deadline_ms:         outcome = NO
  elif now*1000 >= deadline_ms + grace:     outcome = VOID
  else: panic (pending)

claim(target, side, units, salt)           called by the claim note script
  assert outcome != 0
  key = hash_elements([target, side, units, salt]); assert positions[key] == 1; positions[key] = 2
  payout_units = outcome == VOID ? units : (assert side == outcome; units * total / totals[outcome])
  output_note::create(P2ID to target) + add_asset(payout_units * unit)   floor division, dust stays
```

`// ponytail:` stakes are whole units (unit = 1 token) and totals stay under 2^32 so `units * total`
fits u64. Move to u128 or a fixed-point multiplier if a pot ever exceeds four billion tokens.

**stake-note** (private note, tag = pot). Storage `[side, salt(4)]`, assets = the stake. In the pot's
context (`account.get_id() == pot`): move the asset in and call `stake(sender, side, salt, asset)`. In
any other context: assert the consuming account is the note's sender and `tx::get_block_number() <
lock_height` is irrelevant here because an unopened note is always the bettor's to take back; move the
assets to the bettor's wallet. Whether one Rust note can bind both the pot interface and `BasicWallet` is
the first spike **[POC]**; the fallback is this one script in Miden Assembly, modeled on `p2ide.masm`.

**claim-note** (private note, only meaningful to the pot). Storage `[target(2), side, units, salt(4)]`.
Calls `claim(target, side, units, salt)`. Anyone who knows the tuple can create it: the winner's client, or
the operator on the winner's behalf, since the commitment binds the payout target.

**settle-script**: a `#[tx_script]` that calls `settle()`. The client attaches the oracle as a foreign
account with the map key: `ForeignAccount.public(oracleId,
AccountStorageRequirements.fromSlotAndKeysArray([new SlotAndKeys("oracle::entries", [FEED_KEY])]))`
**[VERIFIED in the SDK typings]**. FPI passes 4 felts in and gets 4 out, inside the 16-felt caps
**[VERIFIED in the compiler pitfalls skill]**. The `stake` and `claim` calls carry 9 felts each.

### Flow

| Step | Who | Transaction | Notes |
|---|---|---|---|
| 0. Deploy | Operator | Create oracle account; create one pot per ladder date; fund both with fee tokens | `operator oracle deploy`, `operator pot deploy` |
| 1. Bet | Bettor | Own output note: private stake note to the pot | Delivered to the pot through the transport service (`client.notes.sendPrivate`) or a note file |
| 2. Take back | Bettor | Consume own stake note | Only while the pot has not opened it |
| 3. Batch | Operator | One transaction consuming every waiting stake note | Totals move, commitments appear. Rule: five waiting or 24 hours |
| 4. Read odds | Anyone | None | `RpcClient.getAccountDetails(pot)`, `totals` slot |
| 5. Resolve | Operator | Transaction script calling `publish_entry` on the oracle | Mock CLI; later Pragma's publisher |
| 6. Settle | Operator | Settle script on the pot with the oracle as foreign account | Idempotent; admin button later |
| 7. Payout | Operator | Create claim notes for all winners from its records, then one transaction consuming them | Pot emits private P2ID notes; operator forwards each through the transport service |
| 7b. Self claim | Winner | Own output note: claim note to the pot | For anyone who does not want to wait for the operator |
| 8. Receive | Winner | Consume the P2ID payout note | Standard wallet consumption |

Fees: the executing account pays from its own vault, so the pot and the oracle hold fee tokens. The SDK's
fee-aware builder handles user transactions. Stakes use one fungible asset per market: the testnet faucet
token now, USDCx on mainnet **[VERIFIED, v0.16 blog]**.

### Why the operator executes the pot

I considered a pot anyone can execute (no auth component), which would remove the operator from the
liveness path. On Miden the executing account pays the fee from its own vault, so a pot anyone can execute
is a fee-drain target. The operator key therefore executes batches, settle and payout. It cannot cheat:
totals only move through `stake`, outcomes only through the oracle, payouts only against commitments. It
can only be slow or absent. Stake notes the pot has not opened are always reclaimable by the bettor, so
only funds already in the pot depend on the operator showing up. A network-account pot (executed by the
network transaction builder) is the eventual answer for operator-free liveness; its testnet liveness is
unverified and the RPC rejects user transactions on network accounts after deployment **[VERIFIED in node
v0.16.0]**, so not now.

## 6. Mocked settlement and the operator CLI

`operator/` is a Node CLI on the SDK's Node build (native N-API with SQLite, confirmed working on this
Mac). It holds the oracle key and the pot keys.

- `oracle deploy | heartbeat | resolve --post-id <id> | read`. `resolve` fetches
  `cdn.syndication.twimg.com/tweet-result` for the id (free, undocumented, working today; the paid X API v2
  lookup at $0.005 per read is the cross-check), applies the section 3 rules, stores the raw JSON and its
  sha256 under `operator/evidence/`, and publishes `[0, snowflake_ms, 0, now]`. `heartbeat` publishes
  `[0, 0, 0, now]`; run it daily and right after each ladder date. `operator/rules.mjs` holds the
  normalization and matching with a self-check over fixtures (case, emoji, long post, quote, repost, edit
  chain).
- `pot deploy --deadline --lock-height --grace --unit --asset --oracle`.
- `pot inbox`: pulls private stake notes addressed to the pot from the transport service and records each
  tuple (sender, side, units, salt) locally.
- `pot batch [--force]`: opens every waiting note in one transaction when five are waiting or 24 hours have
  passed since the last batch.
- `pot settle`, `pot payout`, `pot status` (totals, outcome, waiting count, next batch time).

Trust in the MVP: whoever holds the oracle key decides the outcome, and the evidence folder makes it
auditable after the fact. Same trust shape as a single Pragma publisher.

## 7. How Pragma replaces the mock

What exists **[VERIFIED live on 2026-09-24]**: Pragma runs an oracle account
(`0x3b306d819a19b691205480e1619b5c`) and one registered publisher account
(`0x22a42798e8519c914214f1a63009c8`) on Miden testnet v0.16, publishing 14 price feeds. The publisher
stores `[0, price, decimals, timestamp]` per feed key and exposes `get_entry`. Readers use FPI. Pragma's
own oracle procedure `get_median` fans out to publishers with nested FPI, and the Miden docs ship a
tutorial for it. The repo `astraly-labs/pragma-miden` is maintained (last push 2026-09-15, migrated to
0.16 on 2026-09-12). Their website calls Pragma "the Miden oracle". "Addresses change between testnet
iterations" per their README.

What Pragma does not have: any boolean or event feed. Their Starknet optimistic oracle is deprecated, and
the docs say "if you are building a prediction market or anything that requires an optimistic oracle, let
us know and we can help you set up a custom solution". `get_median` is unusable for resolution as is: it
drops entries older than one hour and averages the two middle values with an even publisher count.

The switch, on my side: deploy the next pots with `oracle` = Pragma's publisher account id, `oracle_root`
= its `get_entry` procedure root, `feed_key` = the agreed feed id. `settle()` already reads `get_entry` and
interprets `[_, value, _, timestamp]`. This holds if Pragma publishes the feed on a publisher account with
the current component. If they prefer a new component with a different entry layout, `settle()` gets a
second decode branch and existing pots keep their pointer.

What Pragma would provide **[ASK PRAGMA]**: a dedicated feed id (for example `100:0`) whose `price` is the
announcement timestamp in ms and whose `timestamp` is their observation time, pushed at their price-pusher
cadence (every few seconds today) so the heartbeat is free. A second publisher for redundancy. A stated
process for how they observe and sign an X post fact.

What I would bring to the conversation:

1. Who operates the single registered testnet publisher today, and will there be a second one?
2. Mainnet plan for Miden, and who holds the oracle account key that registers publishers.
3. Will they run an event feed with the value semantics above, on what commercial terms.
4. Should the feed live on their existing publisher component, or a new component with a 4-felt layout
   (outcome, post id, phrase hash limbs)?
5. Is `MAX_ENTRY_AGE_SECONDS = 3600` configurable, or should readers always use `get_entry` directly?
6. How they source an X post fact (API pull, human review) and the latency from post to publish.
7. Dispute path now that their optimistic oracle is deprecated.
8. Key rotation and compromise procedure for the ECDSA publisher key.
9. Will account ids survive the next testnet reset, or is a name registry planned?
10. Monitoring on the Miden feed, given their September 2026 report says the Miden endpoint exposes no
    observation times or source counts.

## 8. Components inventory

| Component | Tech | Status |
|---|---|---|
| `contracts/oracle` | Rust account component | To write, mirrors Pragma's publisher layout |
| `contracts/pot` | Rust account component | To write, ~200 lines, evolves `~/Code/miden-10-block-pot` |
| `contracts/stake-note` | Rust note script (Miden Assembly fallback) | To write, from the p2ide example |
| `contracts/claim-note`, `contracts/settle-script` | Rust note and transaction scripts | To write, tiny |
| `integration/` | Rust, `miden-testing` 0.16 MockChain | Batches, settle branches, claim math, time control with `prove_next_block_at` |
| `operator/` | Node, `@miden-sdk/miden-sdk` 0.16.3 Node build | Oracle and pot commands, evidence, rules self-check |
| `web/` | React 19, Vite, `@miden-sdk/miden-sdk` 0.16.3, `@miden-sdk/react` 0.16.2 | From `frontend-template` at v0.16; user and admin views |
| Toolchain | midenup 0.16.0 (midenc, cargo-miden), Rust nightly-2026-09-01, wasm32-wasip2, guest SDK `miden` 0.14 | As pinned by the template **[VERIFIED after syncing the template today]** |
| Miden testnet | `https://rpc.testnet.miden.io`, transport `https://transport.miden.io` | Live, v0.16 |
| X syndication endpoint | `cdn.syndication.twimg.com/tweet-result` | Free, undocumented, no SLA |
| X API v2 | `GET /2/tweets/:id`, pay per use $0.005 per read | Optional cross-check |
| Pragma publisher | `astraly-labs/pragma-miden` component on testnet | Later, needs their feed |

## 9. Trust assumptions, technical risks, unresolved questions

Trust:

- Oracle key holder (mock) or Pragma's publisher key (later) decides the outcome. Write-once value and
  public evidence make a wrong outcome visible, they do not make it reversible.
- Operator key for liveness only. It cannot create positions, move totals or pay anyone outside the code.
- Transport service sees stake and payout note contents in plaintext. Note files avoid it at a UX cost.
- A delegated prover would see private note data. Local proving by default.
- The X syndication endpoint is undocumented. The API v2 lookup is the paid fallback.
- Bettors keep their own client store. Losing it loses the private account, which is Miden's custody model.

Timestamp semantics **[VERIFIED in tx.masm]**: the executor chooses the reference block and can choose an
older one, never a future one. So "block timestamp at or after D" (the NO and VOID gates) is sound. A
"before D" gate would not be, which is why YES depends on the oracle value, never on block time.

Technical risks:

- Compiler maturity. Experimental by its own docs; 16-felt caps on cross-context calls (our calls carry 9);
  Felt arithmetic wraps, so compare through `as_canonical_u64`. Kernel names moved between 0.16 and 0.17
  (`get_reference_block_number`), so a testnet upgrade means a re-pin and re-test.
- Dual-context note script in Rust. Unknown whether one `#[account]` binding can name both the pot and
  `BasicWallet` **[POC]**; fallback is one Miden Assembly script.
- Testnet resets. v0.16 was a breaking reset; the next one invalidates oracle, pots and notes. All cheap to
  recreate; the web config holds the ids.
- Batch size and proving time. 1024 input notes per transaction is the kernel cap **[VERIFIED]**; a few
  dozen per daily batch is the realistic load. Measured in phase 1, and the cadence absorbs slowness.
- Stale FPI reads. Mitigated by the write-once value and the block timestamp gates. A late oracle (past
  `D + grace`) lets pending pots settle VOID; the heartbeat cadence makes that an operational rule.
- Small batches early. With one or two notes per batch, amounts are effectively visible. The 24-hour rule
  and a visible "next batch" countdown in the UI set expectations.

Unresolved questions:

- Grace period (30 days proposed) and lock height per market (proposed: the block nearest D).
- Ladder dates for the first markets.
- Unit size per market (1 token proposed).
- Whether payouts should be forwarded by the operator (default) or only self-claimed.
- Fixed-price bets later: a house market maker on top of the pot, funded by the operator.
- zkTLS attestation instead of a trusted publisher: the v0.16 kernel ships ECDSA secp256k1 over keccak as
  an auth scheme (Pragma's publisher uses it), so verifying a Reclaim-style attestor signature in `settle`
  is plausible; no zkTLS transcript verifier exists in Miden Assembly. A spike after the MVP **[POC]**.
- Partner Mainnet timing: the only public mention is a 2026-09-23 GitHub issue on `0xMiden/miden-usdcx`
  referring to "the partner mainnet deployment". The v0.16 blog calls it "the last major testnet release
  before mainnet". No date anywhere.

## 10. Implementation plan and effort

Estimates are my working days, each phase ends with a check that fails if the phase is wrong.

| Phase | Work | Verify | Days |
|---|---|---|---|
| 1. Scaffold + spikes | Copy the v0.16 project template (contracts, integration, pins); spikes: raw FPI from a Rust account procedure into an oracle map entry, dual-context Rust note (else MASM), 30 stake notes in one MockChain transaction, `hash_elements` commitment round trip | `cargo test -p integration` passes one test per spike; proving time of the 30-note batch recorded | 1 to 2 |
| 2. Oracle | `contracts/oracle`, `operator oracle deploy/heartbeat/resolve/read`, rules + fixtures | Deployed on testnet, `oracle read` shows the entry; `node operator/rules.mjs` self-check passes | 1 |
| 3. Pot + notes | `contracts/pot`, stake note, claim note, settle script | MockChain tests: batch of N stakes updates totals and commitments; reclaim before batch; stake after lock fails; settle YES, NO via heartbeat, pending fails, VOID after grace; claim math incl. lopsided pot; double claim fails; wrong tuple fails | 3 to 4 |
| 4. Operator CLI + testnet | `pot deploy/inbox/batch/settle/payout/status`, transport delivery both ways, evidence | Full cycle on testnet from the CLI with two bettor wallets: bet, batch, resolve, settle, payout, receive | 2 |
| 5. Web app | User: wallet, faucet funding, bet, my bets, self claim, totals and implied odds from chain, next batch countdown. Admin: waiting notes, batch, settle, payout, oracle panel | Vitest on note building; two-browser run on testnet | 4 to 5 |
| 6. End to end + docs | Two ladder pots, one resolves YES and one NO with the mock oracle; README runbook | Recorded run with account, note and transaction ids in the README | 1 to 2 |

MVP total: 12 to 16 days.

After the MVP:

| Step | Days |
|---|---|
| Point new pots at Pragma's publisher (config plus coordination) | 0.5 plus their lead time |
| House market maker bot for fixed-price bets | 2 to 3 |
| Private pot with proof-backed published totals | 3 to 4 |
| Network-account pot for operator-free liveness | 2, once testnet liveness is confirmed |
| ECDSA attestation verified in `settle` (zkTLS-ready oracle) | 3 to 5, uncertain |

## 11. Decisions already taken

- Format: binary before-D, one pari-mutuel pot per ladder date, public per-side totals.
- Rust on the v0.16 template for every contract, MockChain tests, TypeScript for operator and web.
- Positions as hash commitments; payouts through claim notes; batches of five or 24 hours.
- Oracle mirrors Pragma's publisher read interface; the pointer lives in the pot's storage.
- Operator-executed pot with owner auth; bettor reclaim of unopened notes; VOID after grace.
- One fungible asset per market, whole-token units.

## 12. Sources

Checked 2026-09-24 unless noted.

- `@miden-sdk/miden-sdk` 0.16.3 on npm, typings in `dist/st/crates/miden_client_web.d.ts` and
  `dist/st/api-types.d.ts`; repo `github.com/0xMiden/web-sdk`; CHANGELOG 0.16.0 and 0.16.2.
- `github.com/0xMiden/agentic-template` at 9b568c6 (2026-09-21), submodules `project-template` f34abbc
  and `frontend-template` ff0d1cb (v0.16 migrations), synced locally today. Pitfall skill
  `rust-sdk-pitfalls/SKILL.md`. Pins from `project-template/{rust-toolchain,miden-toolchain}.toml`.
- Rust SDK: docs.rs `miden` 0.14.0 (modules `tx`, `note`, `active_note`, `input_note`, `output_note`,
  `storage`; free functions `hash_elements`, `hash_words`; `tx::execute_foreign_procedure`).
  `github.com/0xMiden/compiler` tag sdk/v0.14.0 `examples/p2ide-note/src/lib.rs`.
  `github.com/0xMiden/miden-tutorials` `examples/miden-bank/contracts/deposit-note/src/lib.rs`.
- Protocol tag v0.16.1: `crates/miden-protocol/asm/protocol/src/{tx,active_note,input_note,
  output_note}.masm`; `crates/miden-standards/asm/standards/notes/{p2id,p2ide,swap}.masm`;
  `crates/miden-protocol/src/constants.rs`. Node v0.16.0 `crates/rpc/src/server/api/submit_proven_tx.rs`.
- docs.miden.xyz: accounts introduction, network accounts, notes introduction, reference/protocol/note,
  reference/protocol/transaction, reference/protocol/state, smart-contracts/accounts/storage,
  smart-contracts/notes/output-notes, transactions/transaction-context, tutorials/rust-client/
  foreign_procedure_invocation_tutorial, tutorials/recipes/rust/oracle_tutorial, tutorials/miden-bank,
  builder/faq, web-client/notes, web-client/transactions.
- status.testnet.miden.io (rpc 0.16.0). miden.xyz/blog/testnet-v0-16 (2026-09-14).
  github.com/0xMiden/miden-usdcx/issues/254 (2026-09-23).
- `github.com/astraly-labs/pragma-miden` at ecc9a01 (2026-09-15): README, `crates/accounts/src/
  {oracle,publisher}.masm`, `crates/types/src/entry.rs`, `examples/consume-price`. Live run of
  `consume-price` at 19:50 UTC, block 442148. docs.pragma.build: miden/introduction, miden/publisher,
  starknet/deprecated/optimistic-oracle, api-reference/introduction. pragma.build/updates/
  liquidity-september-2026.
- X: docs.x.com data dictionary, get-post-by-id, get-posts, rate-limits, pricing; devcommunity.x.com
  posts on pay-per-use (2026-02-06), Basic and Pro migrations, API post editing (2025-10-03);
  twitter-archive/snowflake `IdWorker.scala`; live syndication probe of post 2047703170827358451.
- zkTLS: reclaimprotocol/zk-fetch, attestor-core claim-creation.md, reclaim-solidity-sdk Claims.sol;
  tlsnotary.org FAQ and 2026 blog posts; book.vlayer.xyz web proofs; primus-labs/zktls-contracts.
  Miden VM main: `crates/lib/core/asm/crypto/dsa/ecdsa_k256_keccak.masm`.
- `github.com/pplmaverick/miden-weather-market`, `~/Code/miden-10-block-pot`, `~/Code/miden-day-bet_old`.
