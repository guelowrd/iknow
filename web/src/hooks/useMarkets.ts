import { useCallback, useEffect, useState } from "react";
import { useMiden, useMidenClient } from "@miden-sdk/react";
import { POLL_MS } from "@/config";
import { readMarkets, type Market } from "@/lib/iknow";

export function useMarkets() {
  const { isReady, runExclusive } = useMiden();
  const client = useMidenClient();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isReady) return;
    try {
      // MidenProvider auto-syncs every 15 s; reading here avoids a second sync in flight.
      const next = await runExclusive(() => readMarkets(client));
      setMarkets(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isReady, runExclusive, client]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { markets, refresh, error };
}
