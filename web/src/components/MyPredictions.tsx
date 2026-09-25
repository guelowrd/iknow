import { useState } from "react";
import { Win } from "./Win";
import { EXPLORER_URL } from "@/config";
import { fmt, payoutIfWins, short, type Market, type Position } from "@/lib/iknow";

const STATE_LABEL: Record<NonNullable<Position["state"]>, string> = {
  pending: "next batch",
  in: "in pot",
  won: "won",
  lost: "lost",
  paid: "paid",
  refund: "refund",
};

type Props = {
  positions: Position[];
  markets: Market[];
  onWithdraw: (p: Position) => Promise<void>;
  onCollect?: () => void;
  collecting?: boolean;
};

export function MyPredictions({ positions, markets, onWithdraw, onCollect, collecting }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marketOf = (p: Position) => markets.find((m) => m.id === p.market);
  const paid = positions.some((p) => p.state === "paid" || p.state === "refund");
  const current = positions.find((p) => p.noteId === open);

  const withdraw = async (p: Position) => {
    setBusy(true);
    setError(null);
    try {
      await onWithdraw(p);
      setOpen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Win title="My predictions">
      <div className="body">
        <div className="list">
          {positions.length === 0 && <div className="empty">none yet</div>}
          {positions.map((p) => (
            <div key={p.noteId} className={`row${open === p.noteId ? " sel" : ""}`} onClick={() => setOpen(open === p.noteId ? null : p.noteId)}>
              <span><i className={`led ${p.state ?? "pending"}`} /></span>
              <span>{marketOf(p)?.label ?? "?"} · {p.side === 1 ? "YES" : "NO"}</span>
              <span className="right hide-sm">{STATE_LABEL[p.state ?? "pending"]}</span>
              <span className="right">{fmt(p.units)}</span>
            </div>
          ))}
        </div>
        {current && (() => {
          const m = marketOf(current);
          const state = current.state ?? "pending";
          return (
            <div className="detail">
              <div className="q">{m?.question ?? current.market}</div>
              <div className="kv"><span>{current.side === 1 ? "YES" : "NO"} · {fmt(current.units)} MIDEN</span><span>{STATE_LABEL[state]}</span></div>
              {state === "pending" && <div className="kv"><span>not in the pot yet</span><span>{current.relayed === false ? "relay pending" : ""}</span></div>}
              {state === "in" && m && <div className="kv"><span>pays {fmt(payoutIfWins(current, m))} MIDEN if it wins today</span><span>to {short(current.wallet)}</span></div>}
              {(state === "won" || state === "paid") && m && <div className="kv"><span>won · {fmt(payoutIfWins(current, m))} MIDEN</span><span>{state === "paid" ? "sent" : "payout pending"}</span></div>}
              {state === "lost" && <div className="kv"><span>lost</span><span /></div>}
              {state === "refund" && <div className="kv"><span>void · stake refunded</span><span /></div>}
              <div className="kv"><span><a href={`${EXPLORER_URL}/account/${current.market}`} target="_blank" rel="noreferrer">pot on chain</a></span><span>note {short(current.noteId)}</span></div>
              {error && <div className="hint err">{error}</div>}
              <div className="controls">
                <button className="btn" onClick={() => setOpen(null)}>close</button>
                {state === "pending" && <button className="btn wide danger" onClick={() => withdraw(current)} disabled={busy}>{busy ? "withdrawing…" : "withdraw"}</button>}
              </div>
            </div>
          );
        })()}
        {paid && onCollect && (
          <div className="footer"><span>payout sent to your wallet</span><button className="btn link" onClick={onCollect} disabled={collecting}>{collecting ? "collecting…" : "collect"}</button></div>
        )}
      </div>
    </Win>
  );
}
