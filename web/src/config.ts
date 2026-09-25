// Testnet deployment (operator/state.json). A testnet reset invalidates all of these.
export const RPC_URL = "testnet";
export const PROVER = "testnet";
export const NOTE_TRANSPORT_URL = "https://transport.miden.io";
export const FAUCET_URL = "https://faucet-api.testnet.miden.io";
export const EXPLORER_URL = "https://testnet.midenscan.com";
export const BREAD_URL = "https://miden.xyz/bread";

/** MIDEN testnet token (the fee faucet): 6 decimals, predictions are whole tokens. */
export const MIDEN_FAUCET = "0x18101fa522c174b165efd4f70a0385";
export const UNIT = 1_000_000n;

export const ORACLE = "0x91456cba0c509191225c89225c385a";

/** Pots the app shows when /markets.json (written by the operator server) is missing. */
export const MARKETS = [
  { id: "0x8eddfd14bf6626913cb31a58428793", topic: "When will Miden Partner Mainnet be announced?", short: "Miden Partner Mainnet", label: "before Oct 20, 2026", question: "Will Miden Partner Mainnet be announced before Oct 20, 2026?", deadlineMs: Date.parse("2026-10-20T00:00:00Z") },
  { id: "0x1d20145e5360cfd10671e1f093e97c", topic: "When will Miden Partner Mainnet be announced?", short: "Miden Partner Mainnet", label: "before Oct 28, 2026", question: "Will Miden Partner Mainnet be announced before Oct 28, 2026?", deadlineMs: Date.parse("2026-10-28T00:00:00Z") },
  { id: "0xfb13ce79ff4bb7d1310de3bc1c8d3b", topic: "When will Miden Partner Mainnet be announced?", short: "Miden Partner Mainnet", label: "before Nov 5, 2026", question: "Will Miden Partner Mainnet be announced before Nov 5, 2026?", deadlineMs: Date.parse("2026-11-05T00:00:00Z") },
];
export const MARKETS_URL = "/markets.json";
/** Wallets allowed to see the admin view (any address form the SDK parses). */
export const ADMINS = ["mtst1aq583nd0nh9u0qtq6dru9d695v8gkt8y_qr7qqq9wr6w"];
/** Operator server (admin view only; localhost). */
export const ADMIN_URL = "http://127.0.0.1:5181";
/** The operator opens waiting notes at every 10-minute mark, or as soon as BATCH_MIN wait. */
export const BATCH_MS = 10 * 60_000;
export const BATCH_MIN = 5;

export const POT_PACKAGE_URL = "/packages/pot.masp";
export const POLL_MS = 20_000;
