#!/usr/bin/env node
// iknow operator CLI: deploys the oracle and pots on testnet, publishes feed entries, opens stake
// batches, settles, pays out. Also drives test bettor wallets so the whole cycle runs from here.
// State (ids, positions) lives in operator/state.json; raw X responses in operator/evidence/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, webcrypto as crypto } from "node:crypto";
import {
  MidenClient, AccountBuilder, AccountComponent, AccountId, AccountStorageMode,
  AccountStorageRequirements, AuthSecretKey, Endpoint, Felt, FungibleAsset,
  Note, NoteAssets, NoteMetadata, NoteRecipient, NoteScript, NoteStorage, NoteTag,
  NoteType, Package, Poseidon2, RpcClient, SlotAndKeys, StorageMap, StorageSlot, TransactionScript, Word,
} from "@miden-sdk/miden-sdk";
import { evaluate, fetchPost, fetchTimeline, snowflakeMs } from "./rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = !!process.env.IKNOW_MOCK;
const STATE_FILE = path.join(ROOT, "operator", MOCK ? "state.mock.json" : "state.json");
/** Transaction options: on testnet wait for inclusion; the mock chain proves blocks on demand. */
const confirm = MOCK ? {} : { waitForConfirmation: true };
/** After a submitted transaction: advance the mock chain, then sync. */
export async function commit(c) {
  if (MOCK) await c.proveBlock();
  await c.sync();
}
const FAUCET_URL = "https://faucet-api.testnet.miden.io";
const ORACLE_SLOT = "oracle::oracle::entries";
export const FEED_KEY_U64 = [0n, 0n, 0n, 100n];
export const DEFAULT_ACCOUNT = "1468873289267171330"; // @0xMiden
export const DEFAULT_PATTERN = "partner mainnet starts now";
/** Pots group by topic: a header question ("When will X be announced?"), a short name for lists,
 * and the stem of each pot's long question; a pot's label is its deadline ("before Oct 20, 2026")
 * and its question is `${stem} ${label}?`. */
export const DEFAULT_TOPIC = "When will Miden Partner Mainnet be announced?";
export const DEFAULT_SHORT = "Miden Partner Mainnet";
/** "When will X happen?" → "Will X happen" */
export const stemOf = (title) => title.replace(/^When will /i, "Will ").replace(/\?$/, "");
const MARKETS_FILE = path.join(ROOT, "web", "public", "markets.json");
const POLL_MS = 3_000;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

export const loadState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { wallets: [], pots: {}, positions: [] });
export const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
export const felt = (n) => new Felt(BigInt(n));
export const word = (a, b, c, d) => Word.newFromFelts([felt(a), felt(b), felt(c), felt(d)]);
export const feedKey = (key = FEED_KEY_U64) => word(...key);
/** Feed key of a question: sha256(account | pattern) folded into four felts. */
export function feedKeyFor(account, pattern) {
  const hash = createHash("sha256").update(`${account}|${pattern}`).digest();
  return Array.from({ length: 4 }, (_, i) => (hash.readBigUInt64LE(i * 8) >> 2n)).map(String);
}
/** Feed key of a pot as u64 strings (older pots share the default key). */
const potFeedKey = (p) => (p.feedKey ?? FEED_KEY_U64.map(String)).map(BigInt);
/** web/public/markets.json: what the app needs to show the pots. */
/** The pot's commitment for a position, as the app computes it (a public map key on chain). */
export const positionKey = (p) => { const t = id(p.wallet); return u64s(Poseidon2.hashElements([t.prefix(), t.suffix(), felt(p.side), felt(p.units), ...p.salt.map(felt)])).join(","); };
export function writeMarkets(state) {
  const markets = Object.entries(state.pots).map(([id, p]) => ({
    id, topic: p.topic ?? DEFAULT_TOPIC, short: p.short ?? DEFAULT_SHORT, stem: p.stem ?? stemOf(p.topic ?? DEFAULT_TOPIC),
    label: p.label, question: p.question, deadlineMs: p.deadlineMs, account: p.account ?? DEFAULT_ACCOUNT,
    pattern: p.pattern ?? DEFAULT_PATTERN, feedKey: potFeedKey(p).map(String),
    // settlement facts for the app: when, from which post, and each payout note by position commitment
    settledAt: p.settledAt ?? null, resolvedAt: p.post?.tsMs ?? null,
    post: p.post ? `https://x.com/${p.post.handle}/status/${p.post.id}` : null,
    payouts: Object.fromEntries(state.positions.filter((x) => x.pot === id && x.payout).map((x) => [positionKey(x), x.payout])),
  }));
  fs.writeFileSync(MARKETS_FILE, JSON.stringify({ oracle: state.oracle?.id, markets }, null, 2) + "\n");
}
export const id = (s) => (s.startsWith("0x") ? AccountId.fromHex(s) : AccountId.fromBech32(s));
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomWord = () => Word.newFromFelts(Array.from({ length: 4 }, () => felt(new DataView(randomBytes(8).buffer).getBigUint64(0) >> 2n)));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Felts are u64: keep them as BigInt (Number loses precision above 2^53).
export const u64s = (w) => Array.from(w.toU64s());
export const tx = (r) => r.txId.toHex?.() ?? String(r.txId);
export const feltValue = (f) => (typeof f.asInt === "function" ? BigInt(f.asInt()) : BigInt(f.toString()));

/** Newest compiled package: `cargo miden build` writes `<name>.masp`, the Rust tests write `out.masp`. */
export function loadPackage(name) {
  const dir = path.join(ROOT, "contracts", name, "target", "miden", "release");
  const candidates = [`${name}.masp`, "out.masp"].map((f) => path.join(dir, f)).filter((p) => fs.existsSync(p));
  if (candidates.length === 0) throw new Error(`no compiled package for ${name}; run cargo miden build --release in contracts/${name}`);
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return Package.deserialize(new Uint8Array(fs.readFileSync(candidates[0])));
}

export async function client() {
  if (MOCK) return MidenClient.createMock();
  return MidenClient.create({
    rpcUrl: "testnet", noteTransportUrl: "https://transport.miden.io", storeName: "iknow-operator", proverUrl: "testnet",
  });
}

export async function feeFaucetId() {
  if (MOCK) return loadState().mockFaucet;
  const rpc = new RpcClient(Endpoint.testnet());
  try {
    return (await rpc.getBlockHeaderByNumber()).feeFaucetId().toString();
  } finally {
    rpc.free?.();
  }
}

export const oracleComponent = () =>
  AccountComponent.fromPackage(loadPackage("oracle"), [StorageSlot.map(ORACLE_SLOT, new StorageMap())]);

/** Pot component with its full storage. `p` = { deadlineMs, lockHeight, graceS, unit, assetIdWord, oracleId, oracleRoot, feedKey } */
export function potComponent(p) {
  const oracle = id(p.oracleId);
  const rev = (w) => (p.reverse ? Word.newFromFelts(w.toFelts().reverse()) : w);
  const slots = [
    StorageSlot.fromValue("pot::pot::market", rev(word(p.deadlineMs, p.lockHeight, p.graceS, p.unit))),
    StorageSlot.fromValue("pot::pot::asset_id", rev(Word.newFromFelts(p.assetIdWord.map(felt)))),
    StorageSlot.fromValue("pot::pot::oracle", Word.newFromFelts([oracle.prefix(), oracle.suffix(), felt(0), felt(0)])),
    StorageSlot.fromValue("pot::pot::oracle_root", Word.newFromFelts(p.oracleRoot.map(felt))),
    StorageSlot.fromValue("pot::pot::feed_key", feedKey(potFeedKey(p))),
    StorageSlot.fromValue("pot::pot::p2id_root", NoteScript.p2id().root()),
    StorageSlot.fromValue("pot::pot::totals", word(0, 0, 0, 0)),
    StorageSlot.fromValue("pot::pot::outcome", word(0, 0, 0, 0)),
    StorageSlot.map("pot::pot::positions", new StorageMap()),
  ];
  return AccountComponent.fromPackage(loadPackage("pot"), slots);
}

/** Public contract with our component plus the standard BasicWallet (so faucet notes fund fees). */
export async function createContract(c, component) {
  const key = AuthSecretKey.rpoFalconWithRNG();
  const built = new AccountBuilder(randomBytes(32))
    .storageMode(AccountStorageMode.public())
    .withAuthComponent(AccountComponent.createAuthComponentFromSecretKey(key))
    .withComponent(component)
    .withBasicWalletComponent()
    .build();
  const account = built.account;
  const accountId = account.id().toString();
  await c.keystore.insert(id(accountId), key);
  await c.accounts.insert({ account });
  return accountId;
}

/** Waits until the account's fee balance covers `reserve`, requesting faucet tokens if needed. */
export async function fund(c, accountId, label) {
  if (MOCK) return mockFund(c, accountId, label);
  const fee = await feeFaucetId();
  const balance = async () => {
    await c.sync();
    const acct = await c.accounts.get(id(accountId));
    return acct ? acct.vault().getBalance(id(fee)) : 0n;
  };
  const before = await balance();
  if (before >= 20_000_000n) return console.log(`${label} already funded: ${before}`);
  console.log(`requesting faucet tokens for ${label} ...`);
  const noteId = await requestFaucetTokens(accountId);
  for (let i = 0; i < 40; i++) {
    await c.sync();
    const available = await c.notes.listAvailable({ account: id(accountId) });
    if (available.some((r) => r.id()?.toString() === noteId)) {
      await c.transactions.consume({ account: id(accountId), notes: [noteId], ...confirm });
      await commit(c);
      return console.log(`${label} funded: ${await balance()}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`funding note ${noteId} never became consumable`);
}

/** Mock chain: mint from a locally created faucet (kept in state.mock.json). */
async function mockFund(c, accountId, label) {
  const state = loadState();
  if (!state.mockFaucet) {
    const faucet = await c.accounts.create({ type: "FungibleFaucet", storage: "public", symbol: "IKNW", decimals: 6, maxSupply: 1_000_000_000_000n });
    state.mockFaucet = faucet.id().toString();
    saveState(state);
  }
  await c.transactions.mint({ account: id(state.mockFaucet), to: id(accountId), amount: 100_000_000n, type: "public" });
  await commit(c);
  await c.transactions.consumeAll({ account: id(accountId) });
  await commit(c);
  const acct = await c.accounts.get(id(accountId));
  console.log(`${label} mock-funded: ${acct.vault().getBalance(id(state.mockFaucet))}`);
}

/** Faucet HTTP flow: metadata, PoW challenge (SHA-256(challenge || nonce_be) below target), get_tokens. */
export async function requestFaucetTokens(accountId) {
  const get = async (p, params) => {
    const res = await fetch(`${FAUCET_URL}/${p}${params ? `?${params}` : ""}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`faucet ${p}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const meta = await get("get_metadata");
  const amount = String(meta.base_amount);
  const pow = await get("pow", new URLSearchParams({ account_id: accountId, amount }));
  const challenge = Uint8Array.from(String(pow.challenge).replace(/^0x/, "").match(/../g), (b) => parseInt(b, 16));
  const input = new Uint8Array(challenge.length + 8);
  input.set(challenge);
  const view = new DataView(input.buffer);
  const target = BigInt(pow.target);
  let nonce = new DataView(randomBytes(8).buffer).getBigUint64(0);
  for (;;) {
    view.setBigUint64(challenge.length, nonce);
    const digest = new DataView(await crypto.subtle.digest("SHA-256", input));
    if (digest.getBigUint64(0) < target) break;
    nonce = BigInt.asUintN(64, nonce + 1n);
  }
  const result = await get("get_tokens", new URLSearchParams({
    account_id: accountId, is_private_note: "false", asset_amount: amount, challenge: pow.challenge, nonce: String(nonce),
  }));
  return result.note_id;
}

export async function readOracleEntry(c, oracleId, key = FEED_KEY_U64) {
  await c.accounts.getOrImport(id(oracleId));
  await c.sync();
  const { storage } = await c.accounts.getDetails(id(oracleId));
  const w = storage.getMapItem(ORACLE_SLOT, feedKey(key));
  const [, valueMs, , observedAt] = w ? u64s(w).map(Number) : [0, 0, 0, 0];
  return { valueMs, observedAt };
}

export async function publish(c, state, valueMs, observedAt, key = FEED_KEY_U64) {
  const [k0, k1, k2, k3] = key;
  const code = `use miden::core::sys

@transaction_script
pub proc main
    padw padw
    push.${observedAt}.0.${valueMs}.0.${k3}.${k2}.${k1}.${k0}
    call.::"miden:oracle/oracle@0.1.0"::"publish-entry"
    dropw dropw dropw dropw
    exec.sys::truncate_stack
end
`;
  const script = await c.compile.txScript({ code, libraries: [{ component: oracleComponent() }] });
  const r = await c.transactions.execute({ account: id(state.oracle.id), script, ...confirm });
    await commit(c);
  console.log(`published value_ms=${valueMs} observed_at=${observedAt} key ${key.join(",")} tx ${tx(r)}`);
}

export async function potDetails(c, potId) {
  await c.accounts.getOrImport(id(potId));
  await c.sync();
  const { account, storage } = await c.accounts.getDetails(id(potId));
  const totals = u64s(storage.getItem("pot::pot::totals")).map(Number);
  const outcome = Number(u64s(storage.getItem("pot::pot::outcome"))[0]);
  const market = u64s(storage.getItem("pot::pot::market")).map(Number);
  return { account, yes: totals[0], no: totals[1], outcome, deadlineMs: market[0], lockHeight: market[1], unit: market[3] };
}

export const arg = (args, name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) { if (fallback === undefined) throw new Error(`missing --${name}`); return fallback; }
  return args[i + 1];
};

// ---------------------------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------------------------

export const commands = {
  async "oracle deploy"(c, state) {
    const oracleId = await createContract(c, oracleComponent());
    state.oracle = { id: oracleId, feedKey: FEED_KEY_U64.map(String) };
    saveState(state);
    console.log(`oracle ${oracleId}`);
    await fund(c, oracleId, "oracle");
  },
  /** Manual override of a pot's feed: value 0 = not announced yet. */
  async "oracle publish"(c, state, args) {
    const key = potFeedKey(state.pots[arg(args, "pot")]);
    await publish(c, state, Number(arg(args, "value")), Number(arg(args, "observed", Math.floor(Date.now() / 1000))), key);
  },
  /** Heartbeat every distinct feed (keeps its value, moves observed_at forward). */
  async "oracle heartbeat"(c, state) {
    const keys = new Map(Object.values(state.pots).map((p) => [potFeedKey(p).join(","), potFeedKey(p)]));
    if (keys.size === 0) keys.set(FEED_KEY_U64.join(","), FEED_KEY_U64);
    for (const key of keys.values()) {
      const { valueMs } = await readOracleEntry(c, state.oracle.id, key);
      await publish(c, state, valueMs, Math.floor(Date.now() / 1000), key);
    }
  },
  /** Fetches an X post, applies the pot's question (account + regex), publishes the timestamp. */
  async "oracle resolve"(c, state, args) {
    const potId = arg(args, "pot");
    const p = state.pots[potId];
    const postId = arg(args, "post-id").replace(/^.*\/status\//, "").replace(/\?.*$/, "");
    const post = await fetchPost(postId);
    const verdict = evaluate(post, { accountId: p.account ?? DEFAULT_ACCOUNT, pattern: p.pattern ?? DEFAULT_PATTERN });
    const file = path.join(ROOT, "operator", "evidence", `${postId}.json`);
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), pot: potId, verdict, post }, null, 2));
    console.log(`evidence ${file}`, verdict);
    if (!verdict.qualifies) return verdict;
    await publish(c, state, verdict.tsMs, Math.floor(Date.now() / 1000), potFeedKey(p));
    for (const q of Object.values(state.pots)) if (potFeedKey(q).join(",") === potFeedKey(p).join(",")) q.post = { id: postId, handle: p.handle, tsMs: verdict.tsMs };
    saveState(state);
    return verdict;
  },
  /** Watches X for every open feed: the earliest qualifying post since the feed's first pot resolves it. */
  async "oracle watch"(c, state, args = []) {
    const only = arg(args, "only", null); // round-robin index from the server: one profile read per tick
    const feeds = new Map();
    for (const [id, p] of Object.entries(state.pots)) {
      const key = potFeedKey(p).join(",");
      const f = feeds.get(key) ?? { pot: id, handle: p.handle, account: p.account ?? DEFAULT_ACCOUNT, pattern: p.pattern ?? DEFAULT_PATTERN, sinceMs: Infinity };
      f.sinceMs = Math.min(f.sinceMs, p.createdMs ?? 0);
      feeds.set(key, f);
    }
    const report = [];
    const list = [...feeds.values()];
    for (const f of only === null ? list : [list[Number(only) % list.length]].filter(Boolean)) {
      if (!f.handle) { report.push(`@? (${f.account}): no handle, not watched`); continue; }
      const { valueMs } = await readOracleEntry(c, state.oracle.id, potFeedKey(state.pots[f.pot]));
      if (valueMs) { report.push(`@${f.handle}: resolved already`); continue; }
      const posts = (await fetchTimeline(f.handle, f.account)).filter((t) => snowflakeMs(t.id_str) >= f.sinceMs);
      const hits = posts.map((t) => evaluate(t, { accountId: f.account, pattern: f.pattern })).filter((v) => v.qualifies).sort((a, b) => a.tsMs - b.tsMs);
      if (hits.length === 0) { report.push(`@${f.handle}: ${posts.length} posts since ${new Date(f.sinceMs).toISOString()}, no match`); continue; }
      const verdict = await commands["oracle resolve"](c, state, ["--pot", f.pot, "--post-id", hits[0].postId]);
      report.push(`@${f.handle}: post ${hits[0].postId} qualifies, published ${verdict.tsMs}`);
    }
    console.log(report.join("\n"));
    return report;
  },
  /** Settles every pot that can be settled (a value, or the deadline passed with a fresh heartbeat), then pays it out. */
  async "pot autosettle"(c, state) {
    const report = [];
    const now = Date.now();
    for (const [id, p] of Object.entries(state.pots)) {
      const d = await potDetails(c, id);
      if (d.outcome !== 0) {
        if (state.positions.some((x) => x.pot === id && !x.claimed && (d.outcome === 3 || x.side === d.outcome))) { await commands["pot payout"](c, state, ["--pot", id]); report.push(`${p.label}: paid out`); }
        continue;
      }
      const key = potFeedKey(p);
      let { valueMs, observedAt } = await readOracleEntry(c, state.oracle.id, key);
      const past = now >= p.deadlineMs + 60_000; // a minute of margin for the block timestamp
      if (!valueMs && !past) { report.push(`${p.label}: open`); continue; }
      if (!valueMs && observedAt * 1000 < p.deadlineMs) { await publish(c, state, 0, Math.floor(now / 1000), key); observedAt = Math.floor(now / 1000); }
      await commands["pot settle"](c, state, ["--pot", id]);
      const after = await potDetails(c, id);
      report.push(`${p.label}: settled ${["pending", "YES", "NO", "VOID"][after.outcome]}`);
      if (after.outcome !== 0) { await commands["pot payout"](c, state, ["--pot", id]); report.push(`${p.label}: paid out`); }
    }
    console.log(report.join("\n"));
    return report;
  },
  async "oracle read"(c, state, args) {
    const potId = arg(args, "pot", undefined);
    const key = potId ? potFeedKey(state.pots[potId]) : FEED_KEY_U64;
    console.log(await readOracleEntry(c, state.oracle.id, key));
  },
  async "pot deploy"(c, state, args) {
    const deadlineMs = Date.parse(arg(args, "deadline"));
    const date = new Date(deadlineMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const handle = arg(args, "handle", "0xMiden").replace(/^@/, "");
    // the numeric id is what the rules check (handles can change); taken from the profile's timeline
    const account = arg(args, "account", handle === "0xMiden" ? DEFAULT_ACCOUNT : (await fetchTimeline(handle))[0]?.user?.id_str);
    if (!account) throw new Error(`no posts found for @${handle}, pass --account`);
    const pattern = arg(args, "pattern", DEFAULT_PATTERN);
    const topic = arg(args, "topic", DEFAULT_TOPIC);
    const short = arg(args, "short", topic === DEFAULT_TOPIC ? DEFAULT_SHORT : stemOf(topic).replace(/^Will /, ""));
    const stem = arg(args, "stem", stemOf(topic));
    const label = arg(args, "label", `before ${date}`);
    const question = `${stem} ${label}?`;
    const feedKey = account === DEFAULT_ACCOUNT && pattern === DEFAULT_PATTERN ? FEED_KEY_U64.map(String) : feedKeyFor(account, pattern);
    // Default lock height: the block expected at the deadline (testnet blocks every ~3 s).
    const height = await c.getSyncHeight();
    const lockHeight = Number(arg(args, "lock-height", height + Math.max(0, Math.floor((deadlineMs - Date.now()) / 3000))));
    const graceS = Number(arg(args, "grace-days", 30)) * 86_400;
    const unit = Number(arg(args, "unit", 1_000_000));
    const asset = await feeFaucetId();
    const assetIdWord = u64s(new FungibleAsset(id(asset), 1n).vaultKey()).map(String);
    const oracleRoot = u64s(Word.fromHex(procedureHash(oracleComponent(), "get_entry"))).map(String);
    const params = { deadlineMs, lockHeight, graceS, unit, assetIdWord, oracleId: state.oracle.id, oracleRoot, asset, topic, short, stem, label, question, handle, account, pattern, feedKey, createdMs: Date.now() };
    const potId = await createContract(c, potComponent(params));
    state.pots[potId] = params;
    saveState(state);
    writeMarkets(state);
    console.log(`pot ${potId} "${question}" deadline ${new Date(deadlineMs).toISOString()} lock ${lockHeight} (now ${height})`);
    await fund(c, potId, "pot");
    return potId;
  },
  async "pot status"(c, state, args) {
    const potId = arg(args, "pot");
    const d = await potDetails(c, potId);
    const asset = state.pots[potId].asset;
    const notes = await stakeNotes(c, potId);
    const shortId = (r) => r.id().toString().slice(0, 10);
    const status = { pot: potId, yesUnits: d.yes, noUnits: d.no, outcome: ["pending", "YES", "NO", "VOID"][d.outcome],
      vault: d.account.vault().getBalance(id(asset)).toString(), waitingNotes: notes.filter((r) => r.inclusionProof()).length,
      waiting: notes.filter((r) => r.inclusionProof()).map(shortId), unconfirmed: notes.filter((r) => !r.inclusionProof()).map(shortId),
      deadline: new Date(d.deadlineMs).toISOString() };
    console.log(status);
    return status;
  },
  async "pot inbox"(c, state, args) {
    const potId = arg(args, "pot");
    await c.notes.fetchPrivate();
    await c.sync();
    const notes = await waitingNotes(c, potId);
    console.log(`${notes.length} stake note(s) waiting for ${potId}`);
  },
  async "pot batch"(c, state, args) {
    const potId = arg(args, "pot");
    const min = Number(arg(args, "min", 1)); // open only once this many notes wait
    await c.notes.fetchPrivate();
    await c.sync();
    const notes = await waitingNotes(c, potId);
    if (notes.length < min) { console.log(notes.length ? `${notes.length} waiting, below ${min}` : "nothing to open"); return 0; }
    const unit = BigInt(state.pots[potId].unit);
    const ids = [];
    for (const record of notes) {
      const note = record.toNote();
      const noteId = note.id().toString();
      const items = note.recipient().storage().items().map(feltValue);
      const amount = note.assets().fungibleAssets()[0]?.amount() ?? 0n;
      const position = {
        pot: potId, wallet: note.metadata().sender().toString(), side: Number(items[2]),
        units: Number(amount / unit), salt: items.slice(3, 7).map(String), noteId, claimed: false,
      };
      if (!state.positions.some((p) => p.noteId === noteId)) state.positions.push(position);
      ids.push(noteId);
    }
    const r = await c.transactions.consume({ account: id(potId), notes: ids, ...confirm });
    await commit(c);
    saveState(state);
    console.log(`opened ${ids.length} note(s) tx ${tx(r)}`);
    return ids.length;
  },
  async "pot settle"(c, state, args) {
    const potId = arg(args, "pot");
    const script = TransactionScript.fromPackage(loadPackage("settle-script"));
    // the pot reads its own feed key from the oracle: that entry must be in the foreign account data
    const storage = AccountStorageRequirements.fromSlotAndKeysArray([new SlotAndKeys(ORACLE_SLOT, [feedKey(potFeedKey(state.pots[potId]))])]);
    const r = await c.transactions.execute({
      account: id(potId), script, foreignAccounts: [{ id: id(state.oracle.id), storage }], ...confirm });
    await commit(c);
    state.pots[potId].settledAt = Date.now();
    saveState(state);
    writeMarkets(state);
    console.log(`settled tx ${tx(r)}`);
    await commands["pot status"](c, state, args);
  },
  async "pot payout"(c, state, args) {
    const potId = arg(args, "pot");
    const d = await potDetails(c, potId);
    if (d.outcome === 0) throw new Error("pot not settled");
    const due = state.positions.filter((p) => p.pot === potId && !p.claimed && (d.outcome === 3 || p.side === d.outcome));
    if (due.length === 0) return console.log("no claims due");
    const operator = state.wallets[0];
    const notes = [];
    const claimIds = [];
    for (const p of due) {
      const target = id(p.wallet);
      const storage = new NoteStorage([
        target.prefix(), target.suffix(), felt(p.side), felt(p.units), ...p.salt.map(felt),
        felt(Number(NoteTag.withAccountTarget(id(p.wallet)).asU32())),
      ]);
      const note = new Note(new NoteAssets(), new NoteMetadata(id(operator), NoteType.Private, NoteTag.withAccountTarget(id(potId))),
        new NoteRecipient(randomWord(), NoteScript.fromPackage(loadPackage("claim-note")), storage));
      claimIds.push(note.id().toString());
      notes.push(note);
    }
    const request = (await c.feeAwareTransactionRequestBuilder(id(operator))).withOwnOutputNotes(notes).build();
    await c.transactions.submit(id(operator), request, confirm);
    await commit(c);
    const r = await c.transactions.consume({ account: id(potId), notes: claimIds, ...confirm });
    await commit(c);
    for (const p of due) p.claimed = true;
    saveState(state);
    console.log(`paid ${due.length} position(s) tx ${tx(r)}`);
    // Hand each payout note to its target: wallets outside this client (Bread, guests) receive it
    // through the transport service; wallets in this client already have it.
    if (MOCK) return;
    // what each position is paid (the pot's formula), to tell the payout notes of one wallet apart
    const pays = (p) => (d.outcome === 3 ? BigInt(p.units) : (BigInt(p.units) * BigInt(d.yes + d.no)) / BigInt(d.outcome === 1 ? d.yes : d.no));
    for (const out of r.result.executedTransaction().outputNotes().notes()) {
      const note = out.intoFull();
      if (!note) continue;
      const [suffix, prefix] = note.recipient().storage().items();
      const target = AccountId.fromPrefixSuffix(prefix, suffix).toString();
      const amount = (note.assets().fungibleAssets()[0]?.amount() ?? 0n) / BigInt(state.pots[potId].unit);
      const p = due.find((x) => !x.payout && x.wallet === target && pays(x) === amount);
      if (p) { p.payout = { note: note.id().toString(), tx: tx(r), at: Date.now() }; saveState(state); writeMarkets(state); }
      try {
        await c.notes.sendPrivateOutput({ noteId: note.id().toString(), to: id(target) });
        console.log(`relayed payout ${note.id().toString().slice(0, 12)} to ${target}`);
      } catch (err) {
        console.log(`relay to ${target} skipped: ${err.message ?? err}`);
      }
    }
  },
  /** Sends the pot's unconsumed payout notes to their wallets again (a relay that failed earlier). */
  async "pot relay"(c, state, args) {
    const potId = arg(args, "pot");
    const sent = await c.notes.listSent();
    const report = [];
    for (const wallet of new Set(state.positions.filter((p) => p.pot === potId && p.claimed).map((p) => p.wallet))) {
      const tag = NoteTag.withAccountTarget(id(wallet)).asU32();
      for (const r of sent) {
        if (r.isConsumed() || r.metadata().tag().asU32() !== tag || r.metadata().sender().toString() !== potId) continue;
        try { await c.notes.sendPrivateOutput({ noteId: r.id().toString(), to: id(wallet) }); report.push(`${r.id().toString().slice(0, 12)} → ${wallet.slice(0, 10)}: sent`); }
        catch (err) { report.push(`${r.id().toString().slice(0, 12)} → ${wallet.slice(0, 10)}: ${String(err.message ?? err).slice(0, 80)}`); }
      }
    }
    console.log(report.join("\n") || "nothing to relay");
    return report;
  },
  async "fund"(c, state, args) {
    const account = arg(args, "account");
    await fund(c, account, account);
  },
  async "wallet new"(c, state) {
    const w = await c.accounts.create({ storage: "private" });
    const wid = w.id().toString();
    state.wallets.push(wid);
    saveState(state);
    console.log(`wallet ${wid}`);
    await fund(c, wid, "wallet");
  },
  async "wallet balance"(c, state, args) {
    const wid = arg(args, "wallet");
    await c.sync();
    const acct = await c.accounts.get(id(wid));
    console.log(`${wid}: ${acct.vault().getBalance(id(await feeFaucetId()))}`);
  },
  async "wallet claim"(c, state, args) {
    const wid = arg(args, "wallet");
    await c.notes.fetchPrivate();
    await c.sync();
    const r = await c.transactions.consumeAll({ account: id(wid), ...confirm });
    await commit(c);
    console.log(`consumed ${r.consumed} note(s)`);
    await commands["wallet balance"](c, state, args);
  },
  async "bet"(c, state, args) {
    const wid = arg(args, "wallet");
    const potId = arg(args, "pot");
    const side = { yes: 1, no: 2 }[arg(args, "side")];
    const units = Number(arg(args, "units"));
    const p = state.pots[potId];
    const salt = u64s(randomWord()).map(String);
    const pot = id(potId);
    const storage = new NoteStorage([pot.prefix(), pot.suffix(), felt(side), ...salt.map(felt)]);
    const script = await c.compile.noteScript({
      code: fs.readFileSync(path.join(ROOT, "contracts", "stake-note.masm"), "utf8"),
      libraries: [{ component: potComponent(p) }],
    });
    const note = new Note(
      new NoteAssets([new FungibleAsset(id(p.asset), BigInt(units) * BigInt(p.unit))]),
      new NoteMetadata(id(wid), NoteType.Private, NoteTag.withAccountTarget(id(potId))),
      new NoteRecipient(randomWord(), script, storage),
    );
    const noteId = note.id().toString();
    const request = (await c.feeAwareTransactionRequestBuilder(id(wid))).withOwnOutputNotes([note]).build();
    const r = await c.transactions.submit(id(wid), request, { ...confirm });
    await commit(c);
    console.log(`staked ${units} unit(s) on ${side === 1 ? "YES" : "NO"} note ${noteId} tx ${tx(r)}`);
    if (MOCK) return;
    try {
      await c.notes.sendPrivateOutput({ noteId, to: id(potId) });
      console.log("note relayed to the pot through the transport service");
    } catch (err) {
      console.log(`transport relay skipped: ${err.message ?? err}`);
    }
  },
};

/** Procedure root hex by export name; compiler packages export quoted kebab-case names. */
export const procedureHash = (component, name) => component.getProcedureHash(`"${name.replace(/_/g, "-")}"`);

/** Stake or claim notes addressed to the pot that this client knows and that are still unspent.
 * Tags only carry part of the target id, so P2ID notes (faucet funding) are excluded explicitly. */
/** Stake notes for the pot the store holds: those with an inclusion proof can be opened; the others
 * came through the transport but their commitment was not found on chain yet (or never will be if
 * the sender's scan hint was above the commitment block). */
export async function stakeNotes(c, potId) {
  const tag = NoteTag.withAccountTarget(id(potId)).asU32();
  const p2id = NoteScript.p2id().root().toHex();
  return (await c.notes.list()).filter((r) =>
    !r.isConsumed() && r.metadata()?.tag().asU32() === tag && r.toNote().script().root().toHex() !== p2id);
}
export async function waitingNotes(c, potId) {
  return (await stakeNotes(c, potId)).filter((r) => r.inclusionProof());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [a, b, ...rest] = process.argv.slice(2);
  const name = commands[`${a} ${b}`] ? `${a} ${b}` : commands[a] ? a : null;
  if (!name) {
    console.log("commands:\n  " + Object.keys(commands).join("\n  "));
    process.exit(1);
  }
  const args = name.includes(" ") ? rest : [b, ...rest].filter((x) => x !== undefined);
  const c = await client();
  try {
    const state = loadState();
    await commands[name](c, state, args);
  } finally {
    await c.terminate();
  }
}
