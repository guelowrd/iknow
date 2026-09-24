// Resolution rules for "@0xMiden posts 'Partner Mainnet starts now'" (docs/feasibility.md section 3).
// Input is the JSON returned by cdn.syndication.twimg.com/tweet-result for one post id.

export const X_USER_ID = "1468873289267171330"; // @0xMiden numeric id: handles can change, ids cannot
export const PHRASE = "partner mainnet starts now";
const TWEPOCH = 1288834974657n;

/** Millisecond UTC timestamp encoded in a post id (Twitter snowflake). */
export const snowflakeMs = (id) => Number((BigInt(id) >> 22n) + TWEPOCH);

/** NFKC, URLs stripped, whitespace collapsed, case-folded. */
export const normalize = (text) =>
  text.normalize("NFKC").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** Applies rules 1 to 4 and 7 to one syndication post. Edits and deletions are handled by the
 * operator (rules 5 and 6): pass the version you observed, keep the raw JSON as evidence.
 * The question is "a post by `accountId` whose normalized text matches `pattern`" (a regex source,
 * matched case-insensitively); defaults are @0xMiden and the exact phrase. */
export function evaluate(post, { accountId = X_USER_ID, pattern } = {}) {
  const re = new RegExp(pattern ?? PHRASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const author = post?.user?.id_str;
  if (author !== accountId) return { qualifies: false, reason: `author ${author} is not ${accountId}` };
  if (post.retweeted_status || post.retweeted_tweet) return { qualifies: false, reason: "repost of someone else" };
  const parentAuthor = post.parent?.user?.id_str ?? post.in_reply_to_user_id_str;
  if (parentAuthor && parentAuthor !== accountId) return { qualifies: false, reason: "reply outside own thread" };
  const text = normalize(post.note_tweet?.text ?? post.text ?? "");
  if (!re.test(text)) return { qualifies: false, reason: "pattern not found" };
  return { qualifies: true, postId: post.id_str, tsMs: snowflakeMs(post.id_str) };
}

/** Undocumented public endpoint; token derivation as used by the syndication widget. */
export async function fetchPost(id) {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`syndication ${res.status} for ${id}`);
  return res.json();
}

// Self-check: `node rules.mjs --check`
if (process.argv.includes("--check")) {
  const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };
  const miden = (over) => ({ id_str: "2047703170827358451", user: { id_str: X_USER_ID }, text: "Partner Mainnet starts now", ...over });
  assert(snowflakeMs("2047703170827358451") === 1777045455067, "snowflake of a known post");
  assert(evaluate(miden({})).qualifies, "exact phrase");
  assert(evaluate(miden({ text: "🚀 PARTNER   mainnet\nstarts now!!! https://t.co/x" })).qualifies, "case, emoji, whitespace, url");
  assert(evaluate(miden({ text: "gm", note_tweet: { text: "long post... Partner Mainnet starts now. Details below." } })).qualifies, "long post text");
  assert(!evaluate(miden({ text: "Partner Mainnet starts... now" })).qualifies, "phrase must be contiguous");
  assert(!evaluate(miden({ text: "Partner Mainnet starts soon" })).qualifies, "different phrase");
  assert(!evaluate(miden({ user: { id_str: "42" } })).qualifies, "other author");
  assert(!evaluate(miden({ retweeted_status: {} })).qualifies, "repost");
  assert(!evaluate(miden({ parent: { user: { id_str: "42" } } })).qualifies, "reply to someone else");
  assert(evaluate(miden({ parent: { user: { id_str: X_USER_ID } } })).qualifies, "reply in own thread");
  assert(evaluate(miden({ quoted_tweet: { user: { id_str: "42" }, text: "Partner Mainnet starts now" } })).qualifies, "quote with own matching text");
  assert(!evaluate(miden({ text: "so true", quoted_tweet: { user: { id_str: "42" }, text: "Partner Mainnet starts now" } })).qualifies, "quote of someone else's text");
  assert(evaluate(miden({})).tsMs === 1777045455067, "timestamp from snowflake");
  assert(evaluate(miden({ text: "Partner Mainnet is live!" }), { pattern: "partner mainnet (is live|starts now)" }).qualifies, "custom regex");
  assert(!evaluate(miden({ user: { id_str: "42" } }), { accountId: "43" }).qualifies, "custom account");
  assert(evaluate(miden({ user: { id_str: "42" } }), { accountId: "42" }).qualifies, "custom account match");
  console.log("rules ok");
}
