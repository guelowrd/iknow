// The operator's commands end to end on the SDK's mock chain (fresh each run, state in
// state.mock.json): deploy refusals, stakes batched into positions, YES payouts pro rata, no early settle.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.IKNOW_MOCK = "1"; // before cli.mjs loads
fs.rmSync(new URL("./state.mock.json", import.meta.url), { force: true });
const { client, commands, commit, loadState, id } = await import("./cli.mjs");
const c = await client();
const LIVE = new URL("../web/public/markets.json", import.meta.url);
const live = fs.readFileSync(LIVE, "utf8"); // Sep 29: a mock run once rewrote it and the operator published it
after(() => c.terminate());

const UNIT = 1_000_000n;
const run = (name, ...args) => commands[name](c, loadState(), args);
const balance = async (account) => { await c.sync(); return (await c.accounts.get(id(account))).vault().getBalance(id(loadState().mockFaucet)); };
const vault = async (pot) => BigInt((await run("pot status", "--pot", pot)).vault);
const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();
let op, w1, w2;

test("deploy refuses a past deadline and an invalid regex", async () => {
  await run("oracle deploy");
  await assert.rejects(run("pot deploy", "--deadline", "2016-09-29T23:59:00Z"), /not in the future/);
  await assert.rejects(run("pot deploy", "--deadline", inDays(90), "--pattern", "("), /not a valid regex/);
  assert.deepEqual(loadState().pots, {});
  for (let i = 0; i < 3; i++) await run("wallet new");
  [op, w1, w2] = loadState().wallets;
});

test("stakes become positions; a plain payment to the pot does not (Sep 26 incident)", async () => {
  const pot = await run("pot deploy", "--deadline", inDays(90), "--lock-height", "100000");
  const before = await vault(pot);
  await run("bet", "--wallet", w1, "--pot", pot, "--side", "yes", "--units", "3");
  await run("bet", "--wallet", w2, "--pot", pot, "--side", "no", "--units", "1");
  await c.transactions.send({ account: id(w2), to: id(pot), token: id(loadState().mockFaucet), amount: 5n * UNIT, type: "public", reclaimAfter: 1000 });
  await commit(c);
  assert.equal(await run("pot batch", "--pot", pot), 2);
  const positions = loadState().positions.map(({ wallet, side, units }) => ({ wallet, side, units })).sort((a, b) => a.side - b.side); // the store lists notes in no fixed order
  assert.deepEqual(positions, [{ wallet: w1, side: 1, units: 3 }, { wallet: w2, side: 2, units: 1 }]);
  const status = await run("pot status", "--pot", pot);
  assert.deepEqual([status.yesUnits, status.noUnits, BigInt(status.vault)], [3, 1, before + 4n * UNIT]);
});

test("YES pays the whole pot to the winner, once", async () => {
  const [pot, p] = Object.entries(loadState().pots).at(-1);
  const funded = (await vault(pot)) - 4n * UNIT;
  await run("oracle publish", "--pot", pot, "--value", String(p.deadlineMs - 1));
  await run("pot settle", "--pot", pot);
  assert.equal((await run("pot status", "--pot", pot)).outcome, "YES");
  const b1 = await balance(w1);
  await run("pot payout", "--pot", pot);
  await run("wallet claim", "--wallet", w1);
  assert.equal((await balance(w1)) - b1, 4n * UNIT, "3 of 3 YES units take the 4 unit pot");
  assert.equal(await vault(pot), funded, "the pot keeps only its fee funding");
  await run("pot payout", "--pot", pot);
  assert.equal(await vault(pot), funded, "a second payout pays nothing");
});

// VOID and NO by heartbeat need the block clock past the deadline; the mock chain only has proveBlock(),
// so integration/tests/settle_test.rs and claim_test.rs cover them with prove_next_block_at.
test("settle refuses a pot that is still pending", async () => {
  const pot = await run("pot deploy", "--deadline", inDays(90), "--lock-height", "100000");
  await assert.rejects(run("pot settle", "--pot", pot), /assertion failed/);
  assert.equal((await run("pot status", "--pot", pot)).outcome, "pending");
});

test("refund sends every open stake back from the pot, then retire drops the pot", async () => {
  const pot = await run("pot deploy", "--deadline", inDays(90), "--lock-height", "100000");
  await run("wallet new"); // w2 holds a P2IDE it cannot reclaim yet, which consumeAll would trip on
  const w3 = loadState().wallets.at(-1);
  await run("bet", "--wallet", w1, "--pot", pot, "--side", "yes", "--units", "2");
  await run("bet", "--wallet", w3, "--pot", pot, "--side", "no", "--units", "1");
  assert.equal(await run("pot batch", "--pot", pot), 2);
  const funded = (await vault(pot)) - 3n * UNIT;
  await assert.rejects(run("pot retire", "--pot", pot), /refund the open positions first/);
  await assert.rejects(run("pot refund", "--pot", Object.keys(loadState().pots)[0]), /settled/, "a settled pot's losers are not refunded");
  const [b1, b3] = [await balance(w1), await balance(w3)];
  assert.equal((await run("pot refund", "--pot", pot)).length, 2);
  await run("wallet claim", "--wallet", w1);
  await run("wallet claim", "--wallet", w3);
  assert.deepEqual([(await balance(w1)) - b1, (await balance(w3)) - b3], [2n * UNIT, 1n * UNIT]);
  assert.equal(await vault(pot), funded, "the pot keeps only its fee funding");
  assert.deepEqual(await run("pot refund", "--pot", pot), [], "a second refund sends nothing");
  assert.ok(loadState().positions.filter((x) => x.pot === pot).every((x) => x.claimed && x.refund?.note));
  await run("pot retire", "--pot", pot);
  const s = loadState();
  assert.ok(!s.pots[pot] && s.retired[pot] && s.positions.some((x) => x.pot === pot), "record kept, pot gone");
  assert.ok(!JSON.parse(fs.readFileSync(new URL("./markets.mock.json", import.meta.url), "utf8")).markets.some((m) => m.id === pot), "gone from the app's list");
});

test("the live markets.json is untouched", () => {
  assert.equal(fs.readFileSync(LIVE, "utf8"), live);
  assert.ok(fs.existsSync(new URL("./markets.mock.json", import.meta.url)), "the mock run wrote its own file");
});
