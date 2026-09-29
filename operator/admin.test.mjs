// Admin API guard: the operator server on the mock chain, probed the way a hostile page or a
// DNS-rebound host would. Every refused call must stop before its route runs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const PORT = 5191;
const ALLOWED = "https://iknow.example";
let server;

before(async () => {
  const { IKNOW_PUBLISH, X_BEARER_TOKEN, ...env } = process.env;
  server = spawn(process.execPath, ["admin.mjs"], {
    cwd: import.meta.dirname,
    env: { ...env, IKNOW_MOCK: "1", IKNOW_ADMIN_PORT: String(PORT), IKNOW_ADMIN_ORIGINS: ALLOWED, IKNOW_WATCH_PAUSE_MS: "3600000" },
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => /operator server on/.test(d) && resolve());
    server.on("exit", (code) => reject(new Error(`admin.mjs exited with ${code}`)));
  });
});
after(() => server.kill());

/** Status code of one request; node:http so the Host header can be forged. */
const call = (method, path, headers = {}, body) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path, headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.end(body);
  });
const json = { "content-type": "application/json" };

test("a foreign origin cannot post", async () => {
  assert.equal(await call("POST", "/payout", { ...json, origin: "https://evil.example" }, '{"pot":"0x00"}'), 403);
});
test("a text/plain post, which skips the CORS preflight, is refused even from an allowed origin", async () => {
  assert.equal(await call("POST", "/payout", { "content-type": "text/plain", origin: ALLOWED }, '{"pot":"0x00"}'), 403);
});
test("an opaque origin is refused", async () => {
  assert.equal(await call("POST", "/payout", { ...json, origin: "null" }, '{"pot":"0x00"}'), 403);
});
test("a DNS-rebound host is refused", async () => {
  assert.equal(await call("GET", "/state", { host: `evil.example:${PORT}` }), 403);
});
test("the allowed origin passes the guard: preflight, then JSON to a route", async () => {
  assert.equal(await call("OPTIONS", "/payout", { origin: ALLOWED, "access-control-request-method": "POST" }), 204);
  assert.equal(await call("POST", "/nope", { ...json, origin: ALLOWED }, "{}"), 404);
});
test("localhost dev servers and origin-less local tools pass", async () => {
  assert.equal(await call("POST", "/nope", { ...json, origin: "http://localhost:5180" }, "{}"), 404);
  assert.equal(await call("GET", "/nope"), 404);
  assert.equal(await call("GET", "/state", { host: `localhost:${PORT}` }), 200);
});
