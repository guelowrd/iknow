// Operator server: one process owning the operator store. Serves the admin API for the web app's
// admin view (localhost only) and runs the schedule: batches on every pot at each 10-minute mark
// (earlier once BATCH_MIN notes wait, checked every minute), an oracle heartbeat at the top of each hour. Run: nohup node admin.mjs > admin.log 2>&1 &
import http from "node:http";
import { client, commands, loadState } from "./cli.mjs";

const PORT = Number(process.env.IKNOW_ADMIN_PORT ?? 5181);
const BATCH_MS = 10 * 60_000;
const BATCH_MIN = 5; // web/src/config.ts BATCH_MIN shows the same number
const c = await client();

// commands share the client, so they run one at a time
let queue = Promise.resolve();
function run(name, args = []) {
  const p = queue.then(() => commands[name](c, loadState(), args));
  queue = p.catch(() => undefined);
  return p;
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function state() {
  const s = loadState();
  const pots = [];
  for (const [id, p] of Object.entries(s.pots)) {
    let status = null;
    try { status = await run("pot status", ["--pot", id]); } catch (err) { status = { error: err.message ?? String(err) }; }
    pots.push({ id, topic: p.topic, label: p.label, question: p.question, deadlineMs: p.deadlineMs, lockHeight: p.lockHeight, account: p.account, pattern: p.pattern, feedKey: p.feedKey, status });
  }
  return { oracle: s.oracle?.id, pots, nextBatchMs: nextBatch(), batchMin: BATCH_MIN };
}

const nextBatch = () => Math.ceil(Date.now() / BATCH_MS) * BATCH_MS;

async function batchAll(min = 1) {
  for (const id of Object.keys(loadState().pots)) {
    try {
      const n = await run("pot batch", ["--pot", id, "--min", String(min)]);
      if (n) log("batch", id, n);
    } catch (err) { log("batch failed", id, err.message ?? err); }
  }
}
function schedule() {
  setTimeout(async () => {
    await batchAll();
    if (new Date().getMinutes() < 10) { try { await run("oracle heartbeat"); } catch (err) { log("heartbeat failed", err.message ?? err); } }
    schedule();
setInterval(() => batchAll(BATCH_MIN), 60_000);
  }, nextBatch() - Date.now() + 2_000);
}

const routes = {
  "GET /state": () => state(),
  "POST /pots": (b) => run("pot deploy", ["--deadline", b.deadline, ...(b.topic ? ["--topic", b.topic] : []), ...(b.label ? ["--label", b.label] : []), ...(b.account ? ["--account", b.account] : []), ...(b.pattern ? ["--pattern", b.pattern] : [])]),
  "POST /batch": (b) => run("pot batch", ["--pot", b.pot]),
  "POST /settle": (b) => run("pot settle", ["--pot", b.pot]),
  "POST /payout": (b) => run("pot payout", ["--pot", b.pot]),
  "POST /heartbeat": () => run("oracle heartbeat"),
  "POST /publish": (b) => run("oracle publish", ["--pot", b.pot, "--value", String(b.valueMs)]),
  "POST /resolve": (b) => run("oracle resolve", ["--pot", b.pot, "--post-id", String(b.postId)]),
};

http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": /^http:\/\/localhost(:\d+)?$/.test(origin) ? origin : "null", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, headers); return res.end(); }
  const route = routes[`${req.method} ${req.url.split("?")[0]}`];
  if (!route) { res.writeHead(404, headers); return res.end(JSON.stringify({ error: "no such route" })); }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const result = await route(body ? JSON.parse(body) : {});
    res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true, result: result ?? null }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  } catch (err) {
    log("error", req.method, req.url, err.message ?? err);
    res.writeHead(500, headers);
    res.end(JSON.stringify({ ok: false, error: err.message ?? String(err) }));
  }
}).listen(PORT, "127.0.0.1", () => log(`operator server on http://127.0.0.1:${PORT}, next batch ${new Date(nextBatch()).toISOString()}`));
schedule();
setInterval(() => batchAll(BATCH_MIN), 60_000);
