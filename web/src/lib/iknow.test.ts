// Pure helpers and the positions store under fuzzing. localStorage is outside the app's control (older
// versions, other tabs, the user), so any content must load as a clean list the app can use; the payout
// preview must match the pot's own formula.
import { beforeEach, expect, test, vi } from "vitest";
import fc from "fast-check";
import { ADMINS } from "@/config";
import { draftOf, felt, loadPositions, parseId, payoutIfWins, pct, pendingState, remaining, short, type Market, type Position } from "./iknow";

if (import.meta.env.FC_SEED) fc.configureGlobal({ seed: Number(import.meta.env.FC_SEED) }); // fixed in the Vercel gate, random in CI
const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)) });
beforeEach(() => store.clear());

const POT = "0x8eddfd14bf6626913cb31a58428793";
const GUEST = "0x68bb1ada527697810a16b628d69bda";
const [BREAD] = ADMINS; // a Bread address as the wallet reports it: bech32 plus a note-tag suffix
const u62 = fc.bigInt({ min: 0n, max: 2n ** 62n - 1n }).map(String);
const word = fc.array(u62, { minLength: 4, maxLength: 4 });
const position = fc.record({
  market: fc.constant(POT), side: fc.constantFrom(1 as const, 2 as const), units: fc.integer({ min: 1, max: 2 ** 32 - 1 }), salt: word,
  serial: fc.option(word, { nil: undefined }), noteId: fc.string(), at: fc.nat(), wallet: fc.constantFrom(GUEST, BREAD),
}, { requiredKeys: ["market", "side", "units", "salt", "noteId", "at", "wallet"] });
/** Stored entries as they may come back: valid, or valid with one field replaced by anything. */
const entry = fc.oneof(position, fc.tuple(position, fc.constantFrom("market", "side", "units", "salt", "serial", "noteId", "wallet"), fc.jsonValue()).map(([p, k, v]) => ({ ...p, [k]: v })));

test("addresses read as Bread shows them", () => {
  expect(short(BREAD)).toBe("mtst1aq5...kt8y");
  expect(short(GUEST)).toBe("0x68bb…9bda");
});

test("any stored content loads as a list every caller can use", () => {
  fc.assert(fc.property(fc.oneof(fc.string(), fc.jsonValue().map((v) => JSON.stringify(v)), fc.array(entry).map((v) => JSON.stringify(v))), (raw) => {
    store.set("iknow:positions", raw);
    const ps = loadPositions();
    expect(Array.isArray(ps)).toBe(true);
    for (const p of ps) {
      // what the wallet filter, the state refresh and a withdraw feed the SDK, which throws on junk
      // (the Node build of the SDK lacks FeltArray, so positionKey itself runs in the browser only)
      parseId(p.wallet);
      parseId(p.market);
      [p.side, p.units, ...p.salt, ...(draftOf(p)?.serial ?? [])].map(felt);
    }
  }), { numRuns: 2_000 });
});

test("valid positions all survive, in order", () => {
  fc.assert(fc.property(fc.array(position), (ps) => {
    store.set("iknow:positions", JSON.stringify(ps));
    expect(loadPositions()).toEqual(JSON.parse(JSON.stringify(ps)));
  }), { numRuns: 500 });
});

test("the payout preview is the pot's formula: floor(units * total / side)", () => {
  const side = fc.integer({ min: 1, max: 2 ** 32 - 1 });
  fc.assert(fc.property(side, side, fc.constantFrom(1 as const, 2 as const), fc.double({ min: 0, max: 1, noNaN: true }), (yes, no, s, share) => {
    const own = s === 1 ? yes : no;
    const units = Math.max(1, Math.floor(own * share));
    const m = { yes, no } as Market;
    expect(payoutIfWins({ side: s, units } as Position, m)).toBe(Number((BigInt(units) * BigInt(yes + no)) / BigInt(own)));
  }), { numRuns: 5_000 });
});

test("odds and countdowns stay in range", () => {
  fc.assert(fc.property(fc.nat(), fc.nat(), (yes, no) => { const v = pct(yes, no); return v >= 0 && v <= 100; }));
  fc.assert(fc.property(fc.integer({ min: -1e12, max: 1e13 }), (ms) => /^(\d+d \d+h|\d+h \d+m|\d+m)$/.test(remaining(ms))));
});

test("a pending note the node does not know is missing only after the grace period", () => {
  expect(pendingState(true, 0)).toBe("pending");
  expect(pendingState(false, 60_000)).toBe("pending");
  expect(pendingState(true, 3_600_000)).toBe("pending");
  expect(pendingState(false, 3 * 60_000)).toBe("missing");
});
