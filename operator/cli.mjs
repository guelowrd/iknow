#!/usr/bin/env node
// iknow operator CLI: deploys the oracle and pots on testnet, publishes feed entries, opens stake
// batches, settles, pays out. Also drives test bettor wallets so the whole cycle runs from here.
// State (ids, positions) lives in operator/state.json; raw X responses in operator/evidence/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto as crypto } from "node:crypto";
import {
  MidenClient, AccountBuilder, AccountComponent, AccountId, AccountStorageMode,
  AccountStorageRequirements, AuthSecretKey, Endpoint, Felt, FungibleAsset,
  Note, NoteAssets, NoteMetadata, NoteRecipient, NoteScript, NoteStorage, NoteTag,
  NoteType, Package, RpcClient, SlotAndKeys, StorageMap, StorageSlot, TransactionScript, Word,
} from "@miden-sdk/miden-sdk";
import { evaluate, fetchPost } from "./rules.mjs";

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
const POLL_MS = 3_000;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

export const loadState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { wallets: [], pots: {}, positions: [] });
export const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
export const felt = (n) => new Felt(BigInt(n));
export const word = (a, b, c, d) => Word.newFromFelts([felt(a), felt(b), felt(c), felt(d)]);
export const feedKey = () => word(...FEED_KEY_U64);
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
    StorageSlot.fromValue("pot::pot::feed_key", feedKey()),
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

export async function readOracleEntry(c, oracleId) {
  await c.accounts.getOrImport(id(oracleId));
  await c.sync();
  const { storage } = await c.accounts.getDetails(id(oracleId));
  const w = storage.getMapItem(ORACLE_SLOT, feedKey());
  const [, valueMs, , observedAt] = w ? u64s(w).map(Number) : [0, 0, 0, 0];
  return { valueMs, observedAt };
}

export async function publish(c, state, valueMs, observedAt) {
  const code = `use miden::core::sys

@transaction_script
pub proc main
    padw padw
    push.${observedAt}.0.${valueMs}.0.100.0.0.0
    call.::"miden:oracle/oracle@0.1.0"::"publish-entry"
    dropw dropw dropw dropw
    exec.sys::truncate_stack
end
`;
  const script = await c.compile.txScript({ code, libraries: [{ component: oracleComponent() }] });
  const r = await c.transactions.execute({ account: id(state.oracle.id), script, ...confirm });
    await commit(c);
  console.log(`published value_ms=${valueMs} observed_at=${observedAt} tx ${tx(r)}`);
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
  async "oracle publish"(c, state, args) {
    await publish(c, state, Number(arg(args, "value")), Number(arg(args, "observed", Math.floor(Date.now() / 1000))));
  },
  async "oracle heartbeat"(c, state) {
    const { valueMs } = await readOracleEntry(c, state.oracle.id);
    await publish(c, state, valueMs, Math.floor(Date.now() / 1000));
  },
  async "oracle resolve"(c, state, args) {
    const postId = arg(args, "post-id");
    const post = await fetchPost(postId);
    const verdict = evaluate(post);
    const file = path.join(ROOT, "operator", "evidence", `${postId}.json`);
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), verdict, post }, null, 2));
    console.log(`evidence ${file}`, verdict);
    if (!verdict.qualifies) return;
    await publish(c, state, verdict.tsMs, Math.floor(Date.now() / 1000));
  },
  async "oracle read"(c, state) {
    console.log(await readOracleEntry(c, state.oracle.id));
  },
  async "pot deploy"(c, state, args) {
    const deadlineMs = Date.parse(arg(args, "deadline"));
    const lockHeight = Number(arg(args, "lock-height", (await c.getSyncHeight()) + 2_000));
    const graceS = Number(arg(args, "grace-days", 30)) * 86_400;
    const unit = Number(arg(args, "unit", 1_000_000));
    const asset = await feeFaucetId();
    const assetIdWord = u64s(new FungibleAsset(id(asset), 1n).vaultKey()).map(String);
    const oracleRoot = u64s(Word.fromHex(procedureHash(oracleComponent(), "get_entry"))).map(String);
    const params = { deadlineMs, lockHeight, graceS, unit, assetIdWord, oracleId: state.oracle.id, oracleRoot, asset };
    const potId = await createContract(c, potComponent(params));
    state.pots[potId] = params;
    saveState(state);
    console.log(`pot ${potId} deadline ${new Date(deadlineMs).toISOString()} lock ${lockHeight}`);
    await fund(c, potId, "pot");
  },
  async "pot status"(c, state, args) {
    const potId = arg(args, "pot");
    const d = await potDetails(c, potId);
    const asset = state.pots[potId].asset;
    const waiting = (await waitingNotes(c, potId)).length;
    console.log({ pot: potId, yesUnits: d.yes, noUnits: d.no, outcome: ["pending", "YES", "NO", "VOID"][d.outcome],
      vault: d.account.vault().getBalance(id(asset)).toString(), waitingNotes: waiting, deadline: new Date(d.deadlineMs).toISOString() });
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
    await c.notes.fetchPrivate();
    await c.sync();
    const notes = await waitingNotes(c, potId);
    if (notes.length === 0) return console.log("nothing to open");
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
  },
  async "pot settle"(c, state, args) {
    const potId = arg(args, "pot");
    const script = TransactionScript.fromPackage(loadPackage("settle-script"));
    const storage = AccountStorageRequirements.fromSlotAndKeysArray([new SlotAndKeys(ORACLE_SLOT, [feedKey()])]);
    const r = await c.transactions.execute({
      account: id(potId), script, foreignAccounts: [{ id: id(state.oracle.id), storage }], ...confirm });
    await commit(c);
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
export async function waitingNotes(c, potId) {
  const tag = NoteTag.withAccountTarget(id(potId)).asU32();
  const p2id = NoteScript.p2id().root().toHex();
  return (await c.notes.list()).filter((r) =>
    !r.isConsumed() && r.inclusionProof() && r.metadata()?.tag().asU32() === tag && r.toNote().script().root().toHex() !== p2id);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
