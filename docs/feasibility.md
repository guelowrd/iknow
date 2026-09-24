# iknow: a private prediction market on Miden

Feasibility study and implementation spec. Written 2026-09-24 against Miden testnet v0.16.
Every technical claim below was checked against current sources on that date (section 12).
Labels: **[VERIFIED]** checked in source or live, **[POC]** needs a proof of concept before I rely on it,
**[ASK PRAGMA]** needs a conversation with the Pragma team.

## 1. Verdict

Feasible now, on testnet v0.16, with the current `@miden-sdk/miden-sdk` 0.16.3 and hand-written Miden
Assembly note scripts. No protocol feature is missing for the MVP. The two things that need a proof of
concept are small: a note script reading an oracle account through foreign procedure invocation (FPI)
inside the MockChain test harness, and the SWAP-style offer script that locks two stakes into one note.
Both have shipped reference code (Pragma's oracle reads through FPI on testnet today, SWAP is a standard
note) so the risk is effort, and the effort is moderate.

Pragma is a real option: it is deployed on Miden testnet v0.16 and I read a live BTC/USD entry from it
during this study. It publishes prices only. Resolving an X post needs a custom feed from them, which their
docs explicitly invite for prediction markets. The MVP mocks that feed with an account that exposes the
same read interface, so switching later is a change of three note inputs, with no contract redesign.

Privacy is real but bounded. Matched bets, their amounts, their sides and their outcomes stay offchain in
private notes. Participation (which account ids transact, when) is public by protocol design. Open offers
are public in the MVP because that is the simplest way for a taker to find them.

## 2. Market format: binary "before D", offered as a short ladder of dates

Each bet answers one question: will @0xMiden post "Partner Mainnet starts now" before instant D (UTC)?
YES wins if the post timestamp is earlier than D. NO wins otherwise, including if nothing has been posted
when D arrives. The app suggests a handful of D values (for example 2026-12-31, 2027-03-31, 2027-06-30) so
liquidity concentrates, but D is just a number in the note, so any date works.

Why this is the simplest useful format:

- Two outcomes, one comparison. The whole settlement rule is `post_ts < D`.
- It resolves as early as possible. A YES resolves the moment the post lands. A NO resolves the moment the
  oracle heartbeat passes D with no post. There is no separate "never" or "expiry" outcome to design.
- A ladder of independent binaries expresses the same information as date buckets. YES on D2 and NO on D1
  is a bet on the (D1, D2) bucket. Users compose it themselves, the contract stays two-sided.
- The oracle interface it needs is a numeric feed: the announcement timestamp, zero until it exists, plus
  the observation time. That is exactly the shape of a price feed entry, which is what Pragma publishes.

Formats I rejected:

- Date buckets in one market: N outcomes means N-way settlement, the market cannot resolve until the last
  bucket closes, and liquidity per bucket is thin.
- Exact date: hundreds of outcomes, no liquidity, and it turns into a raffle. If a raffle is wanted later,
  a "closest guess wins" note is a different product.
- Scalar on the timestamp: needs a price curve and continuous payout. Not needed for a first market.

Payout structure: peer to peer at fixed odds, like a betting exchange. A maker posts an offer "I stake A on
YES, I want B against it". A taker fills it with B. The winner takes A+B. There is no pool and no
pari-mutuel math. Section 5 explains why this beats a pool on Miden today.

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
   attestation. The note also requires the block timestamp to be at or past D (section 9 explains why that
   direction of check is sound on Miden).
10. **Unresolved**: if neither side can claim by `D + grace` (14 days in the MVP), either party can refund.
    Each side gets its own stake back.

Open detail: X's own pages disagree on whether the edit window is 30 or 60 minutes. Rule 5 does not
depend on it.

## 4. What is public, private, revealed

Miden facts that bound this **[VERIFIED]**: note metadata (sender account id, note type, tag) is always
public, even for private notes. Nullifiers are public and cannot be linked back to a note id. A private
account's id and state commitment appear onchain at every update. There is no encrypted note type on
v0.16. The note transport service delivers private note details in plaintext to its server.

| Item | Visibility | Why |
|---|---|---|
| Oracle account, feed value, heartbeat | Public | Read through FPI, must be public |
| Open offer: maker id, side, stake, requested stake, D | Public (MVP) | Public note so takers can discover it by tag |
| That an offer was filled, and by which account id | Public | The fill tx consumes the offer note; block lists the taker's account update and the new note's metadata (sender = taker) |
| Matched bet: both stakes, side, D, parties, oracle pointer | Private | Note storage of a private note, offchain only |
| Who won, how much | Private | Claim consumes a private note: only a nullifier and the winner's account activity appear |
| User balances and history | Private | Private accounts, commitment only |
| Transport server sees bet note contents | Revealed to one party | v0.16 transport is plaintext; note file export is the fallback |
| Delegated prover sees the full transaction witness | Revealed if used | Use local proving for privacy; delegated proving is faster |

Two honest caveats. First, whoever watches the chain sees that account X filled offer O and later that
account X or the maker consumed some private note. Amount and outcome stay hidden, but the fact of
participation does not. Second, the open offer is public in the MVP. Moving offers to a private relay (offer
notes sent through the transport service, or an offchain order list) hides the amounts too, and costs about
two days of work. I list it as the first post-MVP step.

## 5. Architecture and MVP design

Three pieces of Miden Assembly, one Node script, one web app. No backend for the market itself.

```
oracle.masm   account component: map slot `entries`, procs `publish_entry`, `get_entry`
offer.masm    note script, public note: fill path (creates the bet note) and cancel path
bet.masm      note script, private note: claim path (FPI read of the oracle) and refund path
oracle/       Node CLI (SDK Node build): resolve, heartbeat, rules + self-check
web/          React app from 0xMiden/frontend-template v0.16: wallet, offers, bets, claims
```

### Why notes instead of a pool account

I compared a pari-mutuel pool account (stake notes in, claim notes out, per-side totals in storage) against
matched bets living entirely in notes. Notes win for this product:

- Privacy comes from the protocol. A public or network pool exposes its whole vault and storage at every
  update, so every stake amount and the running totals are readable, and the sender id in each stake note
  links the amount to the bettor. A private operator-run pool hides that but adds a trusted operator.
- No operator, no liveness dependency. Every action (offer, fill, cancel, claim, refund) is a transaction the
  user's own client executes. A network-account pool would depend on the testnet network transaction
  builder, whose liveness I could not verify, and user-submitted transactions to a network account are
  rejected by the RPC after deployment **[VERIFIED in node v0.16.0]**, so there is no manual fallback.
- Reference code exists. The claim path is P2ID with a computed target. The fill path is SWAP with the
  payback note replaced by the bet note. Both standard scripts exist at protocol v0.16.1.
- A pool can be added later as a bot that fills offers at posted odds (a house account). That gives
  pool-like UX without touching the contracts.

Prior art on Miden **[VERIFIED]**: `pplmaverick/miden-weather-market` (v0.15, one public contract, bet
commitments in a storage map, pari-mutuel, no real asset notes yet) and `miden-bank` from the official
tutorials (deposit and withdraw notes against a public account). Locally, `~/Code/miden-10-block-pot` is a
pool account in Rust on client 0.12. None of them settle through private notes.

### oracle.masm: same read interface as Pragma's publisher

Pragma's publisher component on Miden stores entries in a map slot and exposes
`get_entry([key]) -> ENTRY` where `ENTRY = [0, price, decimals, timestamp]` **[VERIFIED in
astraly-labs/pragma-miden crates/accounts/src/publisher.masm]**. The mock oracle copies that interface:

```
slot  iknow::oracle::entries        map: FEED_KEY -> [0, value, 0, observed_at]
proc  publish_entry([FEED_KEY, ENTRY])   owner only (account auth), value is write-once
proc  get_entry([FEED_KEY]) -> ENTRY     read, called through FPI by bet.masm
```

`value` is the post timestamp in ms, `0` while pending. `observed_at` is the heartbeat in seconds and only
moves forward. Write-once on `value` matters because FPI reads the foreign account at the transaction's
reference block and that commitment is not part of the public inputs **[VERIFIED in protocol docs]**: a
claimant could pick an older reference block, and with a monotonic feed an older read can only show "not yet".
A claim on that read fails. The winner stays the same.

The bet note holds the oracle pointer as inputs: oracle account id (2 felts), `get_entry` procedure root
(4 felts), feed key (4 felts). Pointing a market at Pragma means creating offers with Pragma's publisher
account id, its `get_entry` root, and the agreed feed key. `bet.masm` does not change.

### bet.masm: P2ID gated by the oracle

Note storage: `[oracle_id(2), get_entry_root(4), feed_key(4), D_ms(2), yes_party(2), no_party(2),
yes_stake, no_stake, faucet_id(2), grace_s]` (about 20 felts, limit is 1024). Assets: `yes_stake +
no_stake` of one fungible asset.

```
main:
  ENTRY = tx::execute_foreign_procedure(oracle_id, get_entry_root, feed_key)
  value = ENTRY[1], observed_at = ENTRY[3]
  if value != 0:            winner = value < D ? yes_party : no_party
  elif observed_at >= D
       and tx::get_block_timestamp() >= D:   winner = no_party
  elif tx::get_block_timestamp() >= D + grace:  refund path
  else: fail (pending)
  claim: assert active_account::get_id == winner; basic_wallet::move_note_assets_to_account
  refund: assert caller is yes_party or no_party; receive own stake;
          create P2ID to the other party with their stake (note_creator::create_note + move_asset_to_note)
```

Kernel calls used exist at v0.16.1: `miden::protocol::tx::execute_foreign_procedure`,
`tx::get_block_timestamp` (u32 seconds), `active_note::get_storage`, `active_account::get_id`,
`basic_wallet::move_note_assets_to_account` (used by p2id.masm), `note_creator::create_note` and
`wallet::move_asset_to_note` (used by swap.masm) **[VERIFIED in the v0.16.1 tag]**. On main,
`get_block_number` was renamed `get_reference_block_number`; `get_block_timestamp` is unchanged. I pin 0.16.

The FPI call passes 4 input felts and gets 4 back, inside the 16-felt caps **[VERIFIED in the compiler
pitfalls skill]**. The consuming client must declare the foreign account with the map key:
`ForeignAccount.public(oracleId, AccountStorageRequirements.fromSlotAndKeysArray([new SlotAndKeys(
"iknow::oracle::entries", [FEED_KEY])]))` **[VERIFIED in the SDK typings]**.

### offer.masm: SWAP with the bet note as payback

Note storage: `[maker(2), maker_side, maker_stake, taker_stake, faucet_id(2), D_ms(2), oracle pointer(10),
grace_s, bet_script_root(4)]`. Assets: `maker_stake`.

```
main:
  if active_account::get_id == maker:  cancel: move_note_assets_to_account; return
  fill (any other account = taker):
    wallet::receive_asset(maker_stake)                    # into taker's vault, as SWAP does
    recipient = compute_and_store_recipient(bet_script_root, bet_inputs(taker = active account))
    idx = note_creator::create_note(private, tag, recipient)
    wallet::move_asset_to_note(faucet_id, maker_stake + taker_stake, idx)   # fails if taker lacks funds
```

The taker cannot alter the bet's inputs because the offer script computes the bet recipient itself and the
kernel checks that the created output note matches. The bet note's serial number derives from the offer's
serial number as SWAP derives its payback serial.

### Transaction flow

Setup, once per oracle: operator creates a public account with `oracle.masm` plus standard Falcon
authentication through the SDK's `client.compile.component` and `AccountBuilder`, funds it for fees,
publishes its id, `get_entry` root and feed key in the web app config.

| Step | Who | Transaction | Notes |
|---|---|---|---|
| 1. Create offer | Maker | Own output note (public, tag = market tag) with `offer.masm`, assets = maker stake | `TransactionRequestBuilder.withOwnOutputNotes` |
| 2. Discover | Taker | None | Client tracks the market tag, `client.sync()` fetches public offer notes |
| 3. Fill | Taker | Consume the offer note (authenticated input note). Script pulls taker stake from the vault and creates the private bet note | Taker's client stores the bet note as its own output note |
| 4. Deliver | Taker | None | `client.notes.sendPrivateOutput({noteId, to: maker})` through the transport service, or export the note file |
| 5. Cancel (optional) | Maker | Consume own offer note | Cancel path |
| 6. Resolve | Oracle operator | Transaction script calling `publish_entry` on the oracle account | Mock: Node CLI. Later: Pragma's publisher |
| 7. Claim | Winner | Consume the bet note with the oracle as foreign account | Local proving keeps the note private |
| 8. Refund | Either party | Consume the bet note after `D + grace` if still pending | Creates a P2ID back to the counterparty |

All user transactions are ordinary client transactions on private accounts. Fees: the SDK's fee-aware
builder handles testnet fees; mainnet fees will be in USDCx **[VERIFIED, v0.16 blog]**. Stakes use one
fungible asset per market: the testnet faucet token now, USDCx on mainnet.

## 6. Mocked settlement

The mock oracle is a Node CLI in `oracle/` using the SDK's Node build (native N-API with SQLite, confirmed
working on this Mac). It holds the oracle account key.

- `oracle deploy`: creates and publishes the oracle account, prints id, procedure root, feed key.
- `oracle heartbeat`: publishes `[0, 0, 0, now]` for the feed. Run it on a schedule (daily) and right after
  each ladder date passes. This is what makes NO claimable.
- `oracle resolve --post-id <id>`: fetches `cdn.syndication.twimg.com/tweet-result` for that id (free,
  undocumented, working today; the paid X API v2 lookup at $0.005 per read is the cross-check), applies the
  section 3 rules, stores the raw JSON and its sha256 under `oracle/evidence/`, and publishes
  `[0, snowflake_ms, 0, now]`.
- `oracle read`: reads the entry back through `RpcClient.getAccountProof` to confirm.
- `oracle/rules.mjs`: the normalization and matching, with a self-check over a few fixtures (case,
  emoji, long post, quote, repost, edit chain). Non-trivial logic gets one runnable check.

Trust in the MVP: whoever holds the oracle key decides the outcome. The evidence folder makes it auditable
after the fact. That is acceptable for a testnet demo among people who know each other, and it is the
same trust shape as a single Pragma publisher.

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

The switch, on my side: create offers whose oracle pointer is Pragma's publisher account id, its
`get_entry` procedure root, and the agreed feed key. Nothing else changes because `bet.masm` already reads
`get_entry` and interprets `[_, value, _, timestamp]`. This holds if Pragma publishes the feed on a
publisher account with the current component. If they prefer a new component with a different entry layout,
`bet.masm` needs a new version with a different decode block, and older bets keep their old script root.

What Pragma would provide **[ASK PRAGMA]**: a dedicated feed id (for example `100:0`) whose `price` is the
announcement timestamp in ms and whose `timestamp` is their observation time, pushed by their price-pusher
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
| `masm/oracle.masm` | Miden Assembly account component | To write, ~40 lines, mirrors Pragma's publisher |
| `masm/bet.masm` | Miden Assembly note script | To write, ~120 lines, from p2id.masm |
| `masm/offer.masm` | Miden Assembly note script | To write, ~150 lines, from swap.masm |
| `tests/` | Rust crate, `miden-testing` 0.16 MockChain | Assembles the three scripts, runs the flows, controls time with `prove_next_block_at` |
| `oracle/` | Node, `@miden-sdk/miden-sdk` 0.16.3 Node build | Deploy, heartbeat, resolve, read, rules self-check |
| `web/` | React 19, Vite, `@miden-sdk/miden-sdk` 0.16.3, `@miden-sdk/react` 0.16.2 | From `frontend-template` at v0.16, extended |
| Miden testnet | `https://rpc.testnet.miden.io`, transport `https://transport.miden.io` | Live, v0.16 |
| X syndication endpoint | `cdn.syndication.twimg.com/tweet-result` | Free, undocumented, no SLA |
| X API v2 | `GET /2/tweets/:id`, pay per use $0.005 per read | Optional cross-check |
| Pragma publisher | `astraly-labs/pragma-miden` component on testnet | Later, needs their feed |

No Rust compiler contracts. The agentic template writes contracts in Rust through the Miden compiler,
but the compiler documents itself as experimental and its note scripts cannot create output notes
directly **[VERIFIED]**; the offer script needs that. The SDK compiles Miden Assembly in the browser and
in Node, so one toolchain covers deploy and runtime. Tests stay in Rust because MockChain is the only
harness with time control and foreign accounts that I could verify. The SDK's `MidenClient.createMock`
might allow TypeScript-only tests; I will spend at most two hours on that at the start **[POC]**.

## 9. Trust assumptions, technical risks, unresolved questions

Trust:

- The oracle key holder (mock) or Pragma's publisher key (later) decides the outcome. Write-once value and
  public evidence make a wrong outcome visible, they do not make it reversible.
- The transport service sees bet note details in plaintext. Note file export avoids it at the cost of UX.
- A delegated prover would see private note data. The web app defaults to local proving.
- The X syndication endpoint is undocumented. The API v2 lookup is the paid fallback.
- Both parties keep their own client store. Losing the store loses the private account and its notes,
  which is Miden's standard custody model.

Timestamp semantics **[VERIFIED in tx.masm]**: the executor chooses the reference block and can choose an
older one, never a future one. So "block timestamp at or after D" (the NO and refund gates) is sound. A
"before D" gate would not be, which is why YES depends on the oracle value, never on block time.

Technical risks:

- Miden Assembly effort. Three scripts, two of them adapted from standards. Kernel names moved between
  0.16 and 0.17 (`get_reference_block_number`), so a testnet upgrade means a re-pin and re-test.
- Testnet resets. v0.16 was a breaking reset; the next one will invalidate the deployed oracle and all
  notes. Accounts and offers are cheap to recreate; the web config holds the ids.
- Stale FPI reads. Mitigated by the write-once value and the block timestamp gates. The refund path can be
  taken by a loser if the oracle publishes after `D + grace`; 14 days of grace against a heartbeat every
  few seconds makes that a non-issue with Pragma and an operational rule with the mock.
- Browser proving time for a note with FPI. Unknown until measured **[POC]**.
- Private note delivery. Transport is plaintext; if it proves flaky, the fallback is a note file the
  taker sends to the maker.
- Liquidity. Peer to peer needs a counterparty. The house bot (post-MVP) fills offers at posted odds.

Unresolved questions:

- Should offers be public (simple discovery) or relayed privately (hides amounts)? MVP: public.
- Which asset on testnet: the public faucet token is the only option; on mainnet USDCx.
- Ladder dates for the first markets.
- Grace period length (14 days proposed).
- zkTLS attestation instead of a trusted publisher: the v0.16 kernel already ships ECDSA secp256k1 over
  keccak as an account auth scheme (Pragma's publisher uses it), so verifying a Reclaim-style attestor
  signature inside `bet.masm` is plausible, and no zkTLS transcript verifier exists in Miden Assembly.
  Worth a spike after the MVP **[POC]**.
- Partner Mainnet timing itself: the only public mention I found is a 2026-09-23 GitHub issue on
  `0xMiden/miden-usdcx` referring to "the partner mainnet deployment". The v0.16 blog calls it "the last
  major testnet release before mainnet". No date anywhere. Good for the market, irrelevant for the build.

## 10. Implementation plan and effort

Estimates are my working days, each phase ends with a check that fails if the phase is wrong.

| Phase | Work | Verify | Days |
|---|---|---|---|
| 1. Scaffold + FPI spike | Repo layout above, pins (protocol 0.16.1, client 0.16.1, testing 0.16, SDK 0.16.3), MockChain harness assembling MASM, a note script that reads a map entry from a foreign account | `cargo test` passes one test that claims a note only when the foreign entry is set | 1 |
| 2. Oracle | `oracle.masm`, Node CLI deploy/heartbeat/resolve/read, rules + fixtures | Deployed on testnet, `oracle read` shows the entry; `node oracle/rules.mjs` self-check passes | 1 |
| 3. Bet note | `bet.masm` claim YES, claim NO via heartbeat, pending fails, refund after grace, wrong claimant fails | Five MockChain tests, one per branch | 2 |
| 4. Offer note | `offer.masm` fill creates the bet note with both stakes, cancel returns the stake, underfunded taker fails | Three MockChain tests plus one end to end (offer, fill, resolve, claim) | 2 to 3 |
| 5. Web app | Fork frontend-template v0.16: wallet + faucet funding (template has it), create offer, browse by tag, fill, my bets, claim, refund, cancel, private delivery, oracle status panel | Vitest for note building; manual two-browser run on testnet | 3 to 4 |
| 6. Testnet end to end + docs | Deploy, two wallets, mock resolve YES on one ladder date and NO on another, claim both, README runbook | Recorded run with note ids and tx ids in the README | 1 to 2 |

MVP total: 10 to 13 days.

After the MVP:

| Step | Days |
|---|---|
| Point a market at Pragma's publisher (config change plus coordination) | 0.5 plus their lead time |
| Private offer relay through the transport service | 2 |
| House bot that fills offers at posted odds (pool-like UX) | 2 to 3 |
| ECDSA attestation verified in `bet.masm` (zkTLS-ready oracle) | 3 to 5, uncertain |

## 11. Decisions already taken

- Format: binary before-D, peer to peer at fixed odds, ladder of dates.
- Contracts in Miden Assembly, tests in Rust MockChain, tooling in TypeScript.
- Mock oracle mirrors Pragma's publisher read interface; the oracle pointer lives in note inputs.
- Offers public, bets private, local proving by default.
- One fungible asset per market.

## 12. Sources

Checked 2026-09-24 unless noted.

- `@miden-sdk/miden-sdk` 0.16.3 on npm, typings in `dist/st/crates/miden_client_web.d.ts` and
  `dist/st/api-types.d.ts`; repo `github.com/0xMiden/web-sdk`; CHANGELOG 0.16.0 and 0.16.2.
- `github.com/0xMiden/agentic-template` at 9b568c6 (2026-09-21), submodules `project-template` and
  `frontend-template` at their v0.16 migrations. Pitfall skill `rust-sdk-pitfalls/SKILL.md`.
- Protocol tag v0.16.1: `crates/miden-protocol/asm/protocol/src/tx.masm`, `active_note.masm`,
  `output_note.masm`; `crates/miden-standards/asm/standards/notes/{p2id,p2ide,swap,pswap}.masm`;
  `crates/miden-protocol/src/constants.rs`. Node v0.16.0
  `crates/rpc/src/server/api/submit_proven_tx.rs`.
- docs.miden.xyz: accounts introduction, network accounts, notes introduction, reference/protocol/note,
  reference/protocol/transaction, reference/protocol/state, smart-contracts/accounts/storage,
  smart-contracts/notes/output-notes, transactions/transaction-context, tutorials/rust-client/
  foreign_procedure_invocation_tutorial, tutorials/recipes/rust/oracle_tutorial, builder/faq,
  web-client/notes, web-client/transactions.
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
- `github.com/pplmaverick/miden-weather-market`, `0xMiden/miden-tutorials` examples/miden-bank,
  `~/Code/miden-10-block-pot`, `~/Code/miden-day-bet_old`.
