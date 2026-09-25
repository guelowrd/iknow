import { useCallback, useEffect, useMemo, useState } from "react";
import { useMiden, useMidenClient } from "@miden-sdk/react";
import { Player } from "@/components/Player";
import { Pots } from "@/components/Pots";
import { MyPredictions } from "@/components/MyPredictions";
import { SaveDialog } from "@/components/SaveDialog";
import { ConnectDialog } from "@/components/ConnectDialog";
import { Admin } from "@/components/Admin";
import { useMarkets } from "@/hooks/useMarkets";
import { useSession } from "@/hooks/useSession";
import { usePrediction } from "@/hooks/usePrediction";
import { useForwarding } from "@/hooks/useForwarding";
import { loadPositions, parseId, positionStates, type Position } from "@/lib/iknow";

/** useMidenClient throws until the client exists, so everything below waits for isReady. */
export default function App() {
  const { isReady, error: midenError } = useMiden();
  if (midenError) return <main className="stack boot"><img className="logo" src="/ik.svg" alt="iKnow" /><div className="tiny">client error: {midenError.message}</div></main>;
  if (!isReady) return <main className="stack boot"><img className="logo blink" src="/ik.svg" alt="iKnow" /><div className="tiny">starting…</div></main>;
  return <Main />;
}

function Main() {
  const { isReady, runExclusive } = useMiden();
  const client = useMidenClient();
  const { markets, refresh, error } = useMarkets();
  const session = useSession();
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

  // the guest wallet is run by the app: payouts are opened, and forwarded to Bread once linked
  const forwarding = useForwarding(session, prediction.relayOutputNote, prediction.status === "idle" && !saving && !connecting);

  // the list follows the connected wallet: a guest sees its own, Bread sees its own plus the
  // browser's guest (which it runs), nobody connected sees nothing
  const mine = useMemo(() => {
    if (!session.address) return [];
    const wallets = [session.address, session.mode === "bread" ? session.guestId : null].filter((a): a is string => !!a).map((a) => parseId(a).toString());
    return positions.filter((p) => wallets.includes(parseId(p.wallet).toString()));
  }, [positions, session.address, session.mode, session.guestId]);

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
        notice={forwarding.notice}
      />
      <Pots markets={markets} selected={selected} onSelect={setSelected} />
      <MyPredictions positions={mine} markets={markets} onWithdraw={withdraw} connected={!!session.address} guestId={session.guestId} />
      {admin && <Admin markets={markets} onChanged={refresh} />}
      {connecting && <ConnectDialog session={session} onClose={() => setConnecting(false)} />}
      {saving && <SaveDialog session={session} onSave={forwarding.forwardNow} onClose={() => setSaving(false)} />}
      <div className="tiny">
        {error ? `sync: ${error}` : "Miden testnet · private predictions, public totals"}
        {" · "}<a href="#admin" onClick={() => setTimeout(refresh, 0)}>admin</a>
        {" · "}<a href="https://github.com/guelowrd/iknow" target="_blank" rel="noreferrer">source</a>
      </div>
    </main>
  );
}
