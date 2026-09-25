import { faucetPow } from "./sha256";

/** Runs the faucet proof of work off the main thread. */
self.onmessage = (e: MessageEvent<{ challenge: number[]; target: string; start: string }>) => {
  postMessage(faucetPow(Uint8Array.from(e.data.challenge), BigInt(e.data.target), BigInt(e.data.start)).toString());
};
