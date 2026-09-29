// Oracle rules under fuzzing: X answers are untrusted JSON, so evaluate must never throw and must
// never let a post by anyone but the pot's account qualify.
import { test } from "node:test";
import fc from "fast-check";
import { evaluate, X_USER_ID } from "./rules.mjs";

const PHRASE = "Partner Mainnet starts now";
const junk = fc.anything();
const author = fc.oneof(fc.constant(X_USER_ID), fc.string(), junk);
/** Posts shaped like the syndication and X API answers, any field missing or of any type. */
const post = fc.record({
  id_str: fc.oneof(fc.bigInt({ min: 0n, max: 2n ** 63n }).map(String), fc.string(), junk),
  text: fc.oneof(fc.constant(PHRASE), fc.string().map((s) => `${s} ${PHRASE} ${s}`), fc.string(), junk),
  user: fc.oneof(fc.record({ id_str: author }), junk),
  note_tweet: fc.oneof(fc.record({ text: fc.oneof(fc.constant(PHRASE), fc.string(), junk) }), junk),
  parent: fc.oneof(fc.record({ user: fc.record({ id_str: author }) }), junk),
  in_reply_to_user_id_str: author,
  retweeted_status: junk,
}, { requiredKeys: [] });
const runs = { numRuns: Number(process.env.FUZZ_RUNS ?? 5_000) };

test("evaluate never throws, whatever X sends", () => {
  fc.assert(fc.property(fc.oneof(post, junk), (p) => { evaluate(p); }), runs);
});
test("only the pot's account can qualify", () => {
  fc.assert(fc.property(post, (p) => !evaluate(p).qualifies || p.user?.id_str === X_USER_ID), runs);
});
test("a qualifying post carries a real timestamp", () => {
  fc.assert(fc.property(post, (p) => { const v = evaluate(p); return !v.qualifies || Number.isFinite(v.tsMs); }), runs);
});
