import { useState } from "react";
import { Close, Win } from "./Win";
import { BATCH_MIN } from "@/config";
import { fmt, mmss, nextBatchMs, payoutIfWins, type Market, type Position } from "@/lib/iknow";
import { useNow } from "@/hooks/useNow";

const STATE_LABEL: Record<NonNullable<Position["state"]>, string> = {
  pending: "next batch",
  in: "in pot",
  won: "won",
  lost: "lost",
  paid: "paid",
  refund: "refund",
};

type Props = { positions: Position[]; markets: Market[]; onWithdraw: (p: Position) => Promise<void> };

/** One row per topic; the individual predictions live in the detail view. */
export function MyPredictions({ positions, markets, onWithdraw }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const marketOf = (p: Position) => markets.find((m) => m.id === p.market);
  const topicOf = (p: Position) => marketOf(p)?.topic ?? "…";
  const topics = [...new Set(positions.map(topicOf))];
  const inTopic = (topic: string) => positions.filter((p) => topicOf(p) === topic);

  const withdraw = async (p: Position) => {
    setBusy(p.noteId);
    setError(null);
    try {
      await onWithdraw(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const right = (p: Position) => {
    const m = marketOf(p);
    const state = p.state ?? "pending";
    if (state === "in" && m) return `${STATE_LABEL.in} · pays ${fmt(payoutIfWins(p, m))} if it wins`;
    if ((state === "won" || state === "paid") && m) return `${STATE_LABEL[state]} · ${fmt(payoutIfWins(p, m))} MIDEN`;
    return STATE_LABEL[state];
  };

  return (
    <Win title="My predictions">
      <div className="body">
        <div className="list">
          {positions.length === 0 && <div className="empty">none yet</div>}
          {topics.map((topic) => {
            const ps = inTopic(topic);
            const pending = ps.filter((p) => (p.state ?? "pending") === "pending").length;
            return (
              <div key={topic} className={`row${open === topic ? " sel" : ""}`} onClick={() => setOpen(open === topic ? null : topic)}>
                <span><i className={`led ${pending ? "pending" : "in"}`} /></span>
                <span>{topic}</span>
                <span className="right hide-sm">{ps.length} prediction{ps.length > 1 ? "s" : ""}{pending ? ` · ${pending} pending` : ""}</span>
                <span className="right">{fmt(ps.reduce((s, p) => s + p.units, 0))}</span>
              </div>
            );
          })}
        </div>
        {open && (
          <div className="detail">
            <div className="q"><Close onClick={() => setOpen(null)} />{open}</div>
            {inTopic(open).map((p) => {
              const state = p.state ?? "pending";
              return (
                <div key={p.noteId} className="item">
                  <div className="kv"><span>{marketOf(p)?.label ?? p.market} · {p.side === 1 ? "YES" : "NO"} {fmt(p.units)}</span><span>{right(p)}</span></div>
                  {state === "pending" && (
                    <div className="kv sub">
                      <span>{p.relayed === false ? "not sent to the pot yet, retrying" : `in the pot in ${mmss(nextBatchMs() - now)} at most, sooner once ${BATCH_MIN} wait`}</span>
                      <button className="btn small danger" onClick={() => withdraw(p)} disabled={busy === p.noteId}>{busy === p.noteId ? "withdrawing…" : "withdraw"}</button>
                    </div>
                  )}
                </div>
              );
            })}
            {error && <div className="hint err">{error}</div>}
          </div>
        )}
      </div>
    </Win>
  );
}
