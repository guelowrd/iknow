import { useCallback, useEffect, useState } from "react";
import { useConsume, useMiden, useMidenClient } from "@miden-sdk/react";
import { Player } from "@/components/Player";
import { Pots } from "@/components/Pots";
import { MyPredictions } from "@/components/MyPredictions";
import { SaveDialog } from "@/components/SaveDialog";
import { ConnectDialog } from "@/components/ConnectDialog";
import { Admin } from "@/components/Admin";
import { useMarkets } from "@/hooks/useMarkets";
import { useSession } from "@/hooks/useSession";
import { usePrediction } from "@/hooks/usePrediction";
import { loadPositions, parseId, positionStates, type Position } from "@/lib/iknow";

/** useMidenClient throws until the client exists, so everything below waits for isReady. */
export default function App() {
  const { isReady, error: midenError } = useMiden();
  if (midenError) return <main className="stack"><div className="tiny">client error: {midenError.message}</div></main>;
  if (!isReady) return <main className="stack"><div className="tiny">starting…</div></main>;
  return <Main />;
}

function Main() {
  const { isReady, runExclusive } = useMiden();
  const client = useMidenClient();
  const { markets, refresh, error } = useMarkets();
  const session = useSession();
  const consume = useConsume();
  const [selected, setSelected] = useState(0);
  const [positions, setPositions] = useState<Position[]>(loadPositions);
  const [admin, setAdmin] = useState(location.hash === "#admin");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const onHash = () => setAdmin(location.hash === "#admin");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const onPlaced = useCallback((p: Position) => setPositions((ps) => [p, ...ps]), []);
  const prediction = usePrediction(session, onPlaced);

  // guest predictions whose relay to the pot failed earlier: try again once the client is up
  useEffect(() => {
    if (!isReady || session.mode !== "guest" || !session.address) return;
    for (const p of loadPositions().filter((p) => p.wallet === session.address && !p.relayed)) {
      prediction.relayOutputNote(p.noteId, p.market).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, session.mode, session.address]);

  // refresh position states whenever the markets refresh
  useEffect(() => {
    if (!isReady || markets.length === 0 || loadPositions().length === 0) return;
    runExclusive(() => positionStates(client, loadPositions(), markets)).then(setPositions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets, isReady]);

  const withdraw = useCallback(async (p: Position) => {
    await prediction.withdraw(p);
    setPositions(loadPositions());
  }, [prediction]);

  // guest wallets pull payout notes from the transport service and consume them
  const [collecting, setCollecting] = useState(false);
  const collect = useCallback(async () => {
    if (!session.address) return;
    setCollecting(true);
    try {
      const address = session.address;
      await runExclusive(async () => {
        await client.fetchPrivateNotes();
        await client.syncState();
      });
      const notes = await runExclusive(() => client.getConsumableNotes(parseId(address)));
      const ids = notes.map((n) => n.inputNoteRecord().id()?.toString()).filter((x): x is string => !!x);
      if (ids.length > 0) await consume.consume({ accountId: address, notes: ids });
      await session.refreshBalance();
    } catch (err) {
      console.error("collect failed", err);
    } finally {
      setCollecting(false);
    }
  }, [session, runExclusive, client, consume]);

  const market = markets[selected] ?? null;
  return (
    <main className="stack">
      <Player
        market={market}
        index={selected}
        count={markets.length}
        session={session}
        prediction={prediction}
        onPrev={() => setSelected((i) => Math.max(0, i - 1))}
        onNext={() => setSelected((i) => Math.min(markets.length - 1, i + 1))}
        onSave={() => setSaving(true)}
        onConnect={() => setConnecting(true)}
      />
      <Pots markets={markets} selected={selected} onSelect={setSelected} />
      <MyPredictions positions={positions} markets={markets} onWithdraw={withdraw} onCollect={session.mode === "guest" ? collect : undefined} collecting={collecting} />
      {admin && <Admin markets={markets} onChanged={refresh} />}
      {connecting && <ConnectDialog session={session} onClose={() => setConnecting(false)} />}
      {saving && <SaveDialog session={session} onSave={prediction.saveToBread} onClose={() => setSaving(false)} />}
      <div className="tiny">
        {error ? `sync: ${error}` : "Miden testnet · private predictions, public totals"}
        {" · "}<a href="#admin" onClick={() => setTimeout(refresh, 0)}>admin</a>
        {" · "}<a href="https://github.com/guelowrd/iknow" target="_blank" rel="noreferrer">source</a>
      </div>
    </main>
  );
}
