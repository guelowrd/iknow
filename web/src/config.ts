// Testnet deployment (operator/state.json). A testnet reset invalidates all of these.
export const RPC_URL = "testnet";
export const PROVER = "testnet";
export const NOTE_TRANSPORT_URL = "https://transport.miden.io";
export const FAUCET_URL = "https://faucet-api.testnet.miden.io";
export const EXPLORER_URL = "https://testnet.midenscan.com";

/** MIDEN testnet token (the fee faucet): 6 decimals, bets are whole tokens. */
export const MIDEN_FAUCET = "0x18101fa522c174b165efd4f70a0385";
export const UNIT = 1_000_000n;

export const ORACLE = "0x91456cba0c509191225c89225c385a";

export const MARKETS = [
  { id: "0x8eddfd14bf6626913cb31a58428793", label: "Oct 20, 2026", deadlineMs: Date.parse("2026-10-20T00:00:00Z") },
  { id: "0x1d20145e5360cfd10671e1f093e97c", label: "Oct 28, 2026", deadlineMs: Date.parse("2026-10-28T00:00:00Z") },
  { id: "0xfb13ce79ff4bb7d1310de3bc1c8d3b", label: "Nov 5, 2026", deadlineMs: Date.parse("2026-11-05T00:00:00Z") },
] as const;
export const MARKET_SUBJECT = "Miden Partner Mainnet";

export const POT_PACKAGE_URL = "/packages/pot.masp";
export const POLL_MS = 20_000;
