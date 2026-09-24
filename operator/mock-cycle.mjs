// End-to-end cycle of the operator CLI against the SDK's in-process mock chain, in one process
// (each createMock() is a fresh chain). Run: IKNOW_MOCK=1 node mock-cycle.mjs
import fs from "node:fs";
import { client, commands, loadState } from "./cli.mjs";

if (!process.env.IKNOW_MOCK) throw new Error("set IKNOW_MOCK=1");
fs.rmSync("state.mock.json", { force: true });
const c = await client();
const run = async (name, args = []) => {
  console.log(`\n$ ${name} ${args.join(" ")}`);
  await commands[name](c, loadState(), args);
};
await run("oracle deploy");
await run("pot deploy", ["--deadline", "2026-12-31T23:59:59Z", "--lock-height", "100000"]);
await run("wallet new");
await run("wallet new");
await run("wallet new");
const s = loadState();
const pot = Object.keys(s.pots).at(-1);
const [, w1, w2] = s.wallets;
await run("bet", ["--wallet", w1, "--pot", pot, "--side", "yes", "--units", "3"]);
await run("bet", ["--wallet", w2, "--pot", pot, "--side", "no", "--units", "1"]);
await run("pot batch", ["--pot", pot]);
await run("pot status", ["--pot", pot]);
await run("oracle heartbeat");
await run("oracle publish", ["--value", "1793491200000"]); // 2026-11-01, before the deadline: YES
await run("pot settle", ["--pot", pot]);
await run("pot payout", ["--pot", pot]);
await run("wallet claim", ["--wallet", w1]);
await run("wallet balance", ["--wallet", w2]);
await run("pot status", ["--pot", pot]);
