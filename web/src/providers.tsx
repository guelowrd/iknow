import { type ReactNode } from "react";
import { MidenProvider } from "@miden-sdk/react";
import { MidenFiSignerProvider } from "@miden-sdk/miden-wallet-adapter-react";
import { WalletAdapterNetwork } from "@miden-sdk/miden-wallet-adapter-base";
import { NOTE_TRANSPORT_URL, PROVER, RPC_URL } from "@/config";

// MidenProvider stays OUTSIDE the wallet provider: the app reads pots and relays notes with its
// own local client, and Bread executes the user's transactions itself through requestTransaction.
// A signer ancestor would block client creation until a wallet connects (frontend-template note).
// useWorker: false keeps one SMT forest, which imported public accounts need (web-sdk#222).
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MidenProvider
      config={{ rpcUrl: RPC_URL, prover: PROVER, noteTransportUrl: NOTE_TRANSPORT_URL, useWorker: false }}
      loadingComponent={<div className="tiny">loading…</div>}
    >
      <MidenFiSignerProvider appName="iKnow" network={WalletAdapterNetwork.Testnet} autoConnect={false}>
        {children}
      </MidenFiSignerProvider>
    </MidenProvider>
  );
}
