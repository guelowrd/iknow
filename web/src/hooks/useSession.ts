import { useCallback, useEffect, useRef, useState } from "react";
import { useMiden, useMidenClient, useSessionAccount } from "@miden-sdk/react";
import { useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { WalletReadyState } from "@miden-sdk/miden-wallet-adapter-base";
import { MIDEN_FAUCET, UNIT } from "@/config";
import { parseId, requestFaucetTokens } from "@/lib/iknow";

export type Session = {
  mode: "bread" | "guest" | null;
  /** Account address as the wallet reports it (bech32 for Bread, hex for guests). */
  address: string | null;
  /** The guest wallet stored in this browser, whichever wallet is active. */
  guestId: string | null;
  /** Whole MIDEN tokens available. */
  balance: number | null;
  /** Exact balance in base units. */
  balanceRaw: bigint | null;
  breadInstalled: boolean;
  breadConnected: boolean;
  breadAddress: string | null;
  breadConnecting: boolean;
  guestStep: string;
  error: string | null;
  /** Use Bread as the active wallet. */
  connectBread: () => Promise<void>;
  /** Connect Bread without leaving the guest (for saving guest funds). */
  linkBread: () => Promise<void>;
  useBread: () => void;
  startGuest: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
};

const GUEST_KEY = "iknow:guest";

export function useSession(): Session {
  const bread = useMidenFiWallet();
  const { isReady, runExclusive } = useMiden();
  const client = useMidenClient();
  const [mode, setMode] = useState<Session["mode"]>(() => (localStorage.getItem(GUEST_KEY) === "1" ? "guest" : null));
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guest = useSessionAccount({
    fund: async (id) => {
      await requestFaucetTokens(id);
    },
    assetId: MIDEN_FAUCET,
    // numeric Falcon discriminant: the SDK's default enum value hangs newWallet (frontend-template note)
    walletOptions: { storageMode: "private", authScheme: 2 as never },
    maxWaitMs: 120_000,
    storagePrefix: "iknow-guest",
  });

  const readyState = bread.wallet?.readyState;
  const breadInstalled = readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable;
  const address = mode === "bread" ? bread.address : mode === "guest" ? guest.sessionAccountId : null;

  // one Bread asset request at a time: StrictMode and provider state changes re-run the effect below
  const breadRef = useRef(bread);
  breadRef.current = bread;
  const reading = useRef(false);
  const breadAddress = bread.address;
  const refreshBalance = useCallback(async () => {
    if (mode === "bread" && reading.current) return;
    reading.current = true;
    try {
      if (mode === "bread" && breadAddress && breadRef.current.requestAssets) {
        const assets = await breadRef.current.requestAssets();
        const faucet = parseId(MIDEN_FAUCET).toString();
        const hit = assets.find((a) => parseId(a.faucetId).toString() === faucet);
        const raw = hit ? BigInt(hit.amount) : 0n;
        setBalanceRaw(raw);
        setBalance(Number(raw / UNIT));
      } else if (mode === "guest" && guest.sessionAccountId && isReady) {
        const id = guest.sessionAccountId;
        const raw = await runExclusive(async () => {
          const account = await client.getAccount(parseId(id));
          return account ? account.vault().getBalance(parseId(MIDEN_FAUCET)) : 0n;
        });
        setBalanceRaw(raw);
        setBalance(Number(raw / UNIT));
      } else {
        setBalance(null);
        setBalanceRaw(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      reading.current = false;
    }
  }, [mode, breadAddress, guest.sessionAccountId, isReady, runExclusive, client]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance, guest.isReady]);

  const linkBread = useCallback(async () => {
    setError(null);
    if (!bread.connected) await bread.connect();
    // the provider's connect() silently returns while an earlier attempt is still marked in flight
    if (!bread.wallet?.adapter.connected) throw new Error("Bread did not connect. Open the Bread extension, then try again.");
  }, [bread]);

  const useBread = useCallback(() => {
    localStorage.removeItem(GUEST_KEY);
    setMode("bread");
  }, []);

  const connectBread = useCallback(async () => {
    try {
      await linkBread();
      useBread();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [linkBread, useBread]);

  /** True while useSessionAccount has a stored wallet it has not loaded into state yet: calling
   * initialize() then would create (and fund) a second wallet. */
  const guestStateLoading = () => !!localStorage.getItem("iknow-guest:accountId") && !guest.sessionAccountId;

  /** Switches to the guest; the effect below creates or resumes the wallet once the mode is set,
   * after the first paint, so "creating…" shows before the wallet code blocks the thread. */
  const startGuest = useCallback(async () => {
    setError(null);
    setMode("guest");
    localStorage.setItem(GUEST_KEY, "1");
  }, []);

  const disconnect = useCallback(async () => {
    if (mode === "bread") await bread.disconnect().catch(() => undefined);
    localStorage.removeItem(GUEST_KEY);
    setMode(null);
    setBalance(null);
    setBalanceRaw(null);
  }, [mode, bread]);

  // create the guest wallet, or resume one created earlier (funding may still be pending); never a second one
  useEffect(() => {
    if (mode !== "guest" || !isReady || guest.isReady || guest.step !== "idle" || guestStateLoading()) return;
    guest.initialize().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isReady, guest.sessionAccountId, guest.step]);

  return {
    mode, address, guestId: guest.sessionAccountId ?? null, balance, balanceRaw, breadInstalled,
    breadConnected: bread.connected, breadAddress: bread.address, breadConnecting: bread.connecting,
    guestStep: guest.step, error: error ?? guest.error?.message ?? null,
    connectBread, linkBread, useBread, startGuest, disconnect, refreshBalance,
  };
}
