import { type ReactNode } from "react";
import { MidenProvider } from "@miden-sdk/react";
import { MidenFiSignerProvider } from "@miden-sdk/miden-wallet-adapter-react";
import { AllowedPrivateData, PrivateDataPermission, WalletAdapterNetwork } from "@miden-sdk/miden-wallet-adapter-base";
import { NOTE_TRANSPORT_URL, PROVER, RPC_URL } from "@/config";
import { WasmWebClient } from "@miden-sdk/miden-sdk";

// QA: ?worker=classic runs the worker Safari and WKWebView get (the SDK picks it by user agent).
const workerMode = new URLSearchParams(location.search).get("worker");
if (workerMode === "classic" || workerMode === "module") (WasmWebClient as unknown as { workerMode: string }).workerMode = workerMode; // static, not in the typings

// MidenProvider stays OUTSIDE the wallet provider: the app reads pots and relays notes with its
// own local client, and Bread executes the user's transactions itself through requestTransaction.
// A signer ancestor would block client creation until a wallet connects (frontend-template note).
// useWorker: true keeps the page responsive while the client works (the SDK's own guidance).
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MidenProvider
      config={{ rpcUrl: RPC_URL, prover: PROVER, noteTransportUrl: NOTE_TRANSPORT_URL, useWorker: true }}
      loadingComponent={<div className="tiny">loading…</div>}
    >
      {/* Assets are shared automatically once granted at connect: with the default UponRequest every
          balance read opened a Bread popup. */}
      <MidenFiSignerProvider
        appName="iKnow"
        network={WalletAdapterNetwork.Testnet}
        autoConnect={false}
        privateDataPermission={PrivateDataPermission.Auto}
        allowedPrivateData={AllowedPrivateData.Assets}
      >
        {children}
      </MidenFiSignerProvider>
    </MidenProvider>
  );
}
