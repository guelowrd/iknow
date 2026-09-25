import {
  AccountComponent, AccountId, Address, Felt, FeltArray, FungibleAsset, Note, NoteArray, NoteAssets, NoteMetadata,
  NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType, Package, Poseidon2, StorageMap, StorageSlot,
  StorageSlotArray, TransactionRequestBuilder, Word, type Account, type WebClient,
} from "@miden-sdk/miden-sdk";
import { BATCH_MS, FAUCET_URL, MARKETS, MARKETS_URL, MIDEN_FAUCET, POT_PACKAGE_URL, UNIT } from "@/config";
import stakeMasm from "../../../contracts/stake-note.masm?raw";

/** topic = the header question ("When will X be announced?"), short = its name in lists, label = the
 * deadline ("before Oct 20, 2026"), question = the pot's long form ("Will X be announced before …?"). */
export type MarketDef = { id: string; topic: string; short: string; label: string; question: string; deadlineMs: number };
export type Market = MarketDef & { yes: number; no: number; outcome: 0 | 1 | 2 | 3; lockHeight: number };
export type Position = {
  market: string;
  side: 1 | 2;
  units: number;
  salt: string[];
  /** Note serial number, needed to rebuild the note (older positions lack it). */
  serial?: string[];
  noteId: string;
  txId?: string;
  at: number;
  wallet: string;
  /** Guest predictions: whether the note reached the pot through the transport service. */
  relayed?: boolean;
  state?: "pending" | "in" | "won" | "lost" | "paid" | "refund";
};

export const felt = (n: bigint | number | string) => new Felt(BigInt(n));
export const parseId = (s: string) => (s.startsWith("0x") ? AccountId.fromHex(s) : AccountId.fromBech32(s));
export const fmt = (units: number) => units.toLocaleString("en-US");
export const pct = (yes: number, no: number) => (yes + no === 0 ? 50 : Math.round((100 * yes) / (yes + no)));
export const randomWord = () =>
  Word.newFromFelts(Array.from({ length: 4 }, () => felt(new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0) >> 2n)));
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export const nextBatchMs = () => Math.ceil(Date.now() / BATCH_MS) * BATCH_MS;
export const OUTCOME = ["pending", "YES", "NO", "VOID"] as const;
export const dateLabel = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** Durations for the display: "m:ss", and "2d 4h" / "4h 12m" / "12m". */
export const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export function remaining(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** What a position pays if its side wins with today's totals (whole tokens). */
export function payoutIfWins(p: Position, m: Market) {
  const total = m.yes + m.no;
  const side = p.side === 1 ? m.yes : m.no;
  return side === 0 ? p.units : Math.floor((p.units * total) / side);
}

// ---------------------------------------------------------------------------------------------
// pots (public accounts imported into the local client)
// ---------------------------------------------------------------------------------------------

export async function loadMarketDefs(): Promise<MarketDef[]> {
  try {
    const res = await fetch(MARKETS_URL, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { markets?: MarketDef[] };
      if (json.markets?.length) return json.markets;
    }
  } catch {
    /* fall back to the built-in list */
  }
  return MARKETS;
}

async function potAccount(client: WebClient, id: string): Promise<Account | undefined> {
  if (!(await client.getAccount(parseId(id)))) await client.importAccountById(parseId(id));
  return client.getAccount(parseId(id));
}

export async function readMarkets(client: WebClient, defs: MarketDef[]): Promise<Market[]> {
  const out: Market[] = [];
  for (const m of defs) {
    const storage = (await potAccount(client, m.id))?.storage();
    const totals = storage?.getItem("pot::pot::totals")?.toU64s();
    const market = storage?.getItem("pot::pot::market")?.toU64s();
    const outcome = Number(storage?.getItem("pot::pot::outcome")?.toU64s()[0] ?? 0n) as Market["outcome"];
    out.push({ ...m, yes: Number(totals?.[0] ?? 0n), no: Number(totals?.[1] ?? 0n), outcome, lockHeight: Number(market?.[1] ?? 0n) });
  }
  return out;
}

/** Same commitment the pot computes: Poseidon2 over [prefix, suffix, side, units, salt]. */
export function positionKey(target: AccountId, side: number, units: number, salt: string[]): Word {
  return Poseidon2.hashElements(new FeltArray([target.prefix(), target.suffix(), felt(side), felt(units), ...salt.map(felt)]));
}

export async function positionStates(client: WebClient, positions: Position[], markets: Market[]): Promise<Position[]> {
  const out: Position[] = [];
  for (const p of positions) {
    const market = markets.find((m) => m.id === p.market);
    const account = await potAccount(client, p.market);
    const flag = Number(account?.storage().getMapItem("pot::pot::positions", positionKey(parseId(p.wallet), p.side, p.units, p.salt))?.toU64s()[0] ?? 0n);
    let state: Position["state"] = flag === 0 ? "pending" : "in";
    if (flag === 2) state = "paid";
    else if (flag === 1 && market?.outcome) state = market.outcome === 3 ? "refund" : market.outcome === p.side ? "won" : "lost";
    out.push({ ...p, state });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// stake notes
// ---------------------------------------------------------------------------------------------

let potComponentPromise: Promise<AccountComponent> | null = null;
/** The pot component, only used to link its `stake` procedure into the note script. */
export function potComponent(): Promise<AccountComponent> {
  potComponentPromise ??= (async () => {
    const res = await fetch(POT_PACKAGE_URL);
    if (!res.ok) throw new Error(`cannot load ${POT_PACKAGE_URL}: ${res.status}`);
    const pkg = Package.deserialize(new Uint8Array(await res.arrayBuffer()));
    const zero = () => Word.newFromFelts([felt(0), felt(0), felt(0), felt(0)]);
    const slots = new StorageSlotArray([
      ...["market", "asset_id", "oracle", "oracle_root", "feed_key", "p2id_root", "totals", "outcome"].map((n) => StorageSlot.fromValue(`pot::pot::${n}`, zero())),
      StorageSlot.map("pot::pot::positions", new StorageMap()),
    ]);
    return AccountComponent.fromPackage(pkg, slots);
  })();
  return potComponentPromise;
}

export const STAKE_MASM = stakeMasm;

export type StakeDraft = { pot: string; sender: string; side: 1 | 2; units: number; salt: string[]; serial: string[] };

const wordStrings = (w: Word) => Array.from(w.toU64s(), String);
export function newDraft(pot: string, sender: string, side: 1 | 2, units: number): StakeDraft {
  return { pot, sender, side, units, salt: wordStrings(randomWord()), serial: wordStrings(randomWord()) };
}

/** Builds the stake note. Call it again for a second identical note: wasm-bindgen moves value args. */
export function buildStakeNote(script: NoteScript, d: StakeDraft): Note {
  const pot = parseId(d.pot);
  const storage = new NoteStorage(new FeltArray([pot.prefix(), pot.suffix(), felt(d.side), ...d.salt.map(felt)]));
  const assets = new NoteAssets([new FungibleAsset(parseId(MIDEN_FAUCET), BigInt(d.units) * UNIT)]);
  const metadata = new NoteMetadata(parseId(d.sender), NoteType.Private, NoteTag.withAccountTarget(parseId(d.pot)));
  return new Note(assets, metadata, new NoteRecipient(Word.newFromFelts(d.serial.map(felt)), script, storage));
}

/** The note of a stored position, for withdrawing it through a wallet that never held the note. */
export function draftOf(p: Position): StakeDraft | null {
  return p.serial ? { pot: p.market, sender: p.wallet, side: p.side, units: p.units, salt: p.salt, serial: p.serial } : null;
}

/** A multisig (Bread with Guardian) reuses the fee conversion salt as its replay guard and
 * rejects a request that declares none, so wallets that execute the request themselves get one. */
export function stakeRequest(note: Note, salt?: Word) {
  const builder = new TransactionRequestBuilder().withOwnOutputNotes(new NoteArray([note]));
  return (salt ? builder.withFeeConversionSalt(salt) : builder).build();
}

export const potAddress = (pot: string) => Address.fromAccountId(parseId(pot));

// ---------------------------------------------------------------------------------------------
// positions in localStorage
// ---------------------------------------------------------------------------------------------

const KEY = "iknow:positions";
export function loadPositions(): Position[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function write(ps: Position[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ps));
  } catch {
    /* private mode: the prediction still exists on chain */
  }
}
export const savePosition = (p: Position) => write([p, ...loadPositions()]);
export const removePosition = (noteId: string) => write(loadPositions().filter((p) => p.noteId !== noteId));
export const markRelayed = (noteId: string) => write(loadPositions().map((p) => (p.noteId === noteId ? { ...p, relayed: true } : p)));

// ---------------------------------------------------------------------------------------------
// testnet faucet (guest wallets)
// ---------------------------------------------------------------------------------------------

/** The faucet proof of work in a worker, so the page stays responsive. */
function powNonce(challenge: Uint8Array, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<string>) => { resolve(e.data); worker.terminate(); };
    worker.onerror = (e) => { reject(new Error(e.message || "proof of work failed")); worker.terminate(); };
    const start = new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0);
    worker.postMessage({ challenge: Array.from(challenge), target, start: start.toString() });
  });
}

/** Requests a public funding note over HTTP; PoW is SHA-256(challenge || nonce_be) below target. */
export async function requestFaucetTokens(accountId: string): Promise<string> {
  const get = async (p: string, params?: URLSearchParams) => {
    const res = await fetch(`${FAUCET_URL}/${p}${params ? `?${params}` : ""}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`faucet ${p}: ${res.status}`);
    return res.json();
  };
  const meta = await get("get_metadata");
  const amount = String(meta.base_amount);
  const pow = await get("pow", new URLSearchParams({ account_id: accountId, amount }));
  const challenge = Uint8Array.from((String(pow.challenge).replace(/^0x/, "").match(/../g) ?? []), (b) => parseInt(b, 16));
  const nonce = await powNonce(challenge, String(pow.target));
  const result = await get("get_tokens", new URLSearchParams({
    account_id: accountId, is_private_note: "false", asset_amount: amount, challenge: pow.challenge, nonce,
  }));
  return result.note_id;
}
