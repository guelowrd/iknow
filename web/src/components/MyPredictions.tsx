import { useState } from "react";
import { Close, Win } from "./Win";
import { BATCH_MIN, EXPLORER_URL } from "@/config";
import { fmt, mmss, nextBatchMs, parseId, payoutIfWins, short, type Market, type Position } from "@/lib/iknow";
import { useNow } from "@/hooks/useNow";

const STATE_LABEL: Record<NonNullable<Position["state"]>, string> = {
  pending: "next batch",
  in: "in pot",
  won: "won",
  lost: "lost",
  paid: "paid",
  refund: "refund",
};

type Props = { positions: Position[]; markets: Market[]; onWithdraw: (p: Position) => Promise<void>; connected: boolean; guestId: string | null };
type Group = { key: string; items: Position[]; state: NonNullable<Position["state"]> };

/** Same pot, side and state gather into one line; pending ones stay apart (each can be withdrawn). */
function gather(ps: Position[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of ps) {
    const state = p.state ?? "pending";
    const key = state === "pending" ? `pending:${p.noteId}` : `${p.market}:${p.side}:${state}`;
    const g = map.get(key) ?? { key, items: [], state };
    g.items.push(p);
    map.set(key, g);
  }
  return [...map.values()];
}

const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** One row per topic; the detail view gathers that topic's predictions, each line opening its notes. */
export function MyPredictions({ positions, markets, onWithdraw, connected, guestId }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const marketOf = (p: Position) => markets.find((m) => m.id === p.market);
  const via = (p: Position) => (guestId && parseId(p.wallet).toString() === parseId(guestId).toString() ? "guest" : "Bread");
  const topicOf = (p: Position) => marketOf(p)?.topic ?? "…";
  const potIndex = (p: Position) => { const i = markets.findIndex((m) => m.id === p.market); return i < 0 ? markets.length : i; };
  // topics and pots in the order of the topics window
  const topics = [...new Set(positions.map(topicOf))].sort((a, b) => markets.findIndex((m) => m.topic === a) - markets.findIndex((m) => m.topic === b));
  const inTopic = (topic: string) => positions.filter((p) => topicOf(p) === topic).sort((a, b) => potIndex(a) - potIndex(b) || a.side - b.side || b.at - a.at);

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

  const right = (g: Group) => {
    const m = marketOf(g.items[0]);
    const pays = m ? g.items.reduce((s, p) => s + payoutIfWins(p, m), 0) : 0;
    if (g.state === "in" && m) return `in pot · pays ${fmt(pays)} if it wins`;
    if ((g.state === "won" || g.state === "paid") && m) return `${STATE_LABEL[g.state]} · ${fmt(pays)} MIDEN`;
    return STATE_LABEL[g.state];
  };

  return (
    <Win title="My predictions">
      <div className="body">
        <div className="list">
          {positions.length === 0 && <div className="empty">{connected ? "none yet" : "connect to see your predictions"}</div>}
          {topics.map((topic) => {
            const ps = inTopic(topic);
            const pending = ps.filter((p) => (p.state ?? "pending") === "pending").length;
            return (
              <div key={topic} className={`row${open === topic ? " sel" : ""}`} onClick={() => setOpen(open === topic ? null : topic)}>
                <span><i className={`led ${pending ? "pending" : "in"}`} /></span>
                <span>{marketOf(ps[0])?.short ?? topic}</span>
                <span className="right hide-sm">{ps.length} prediction{ps.length > 1 ? "s" : ""}{pending ? ` · ${pending} pending` : ""}</span>
                <span className="right">{fmt(ps.reduce((s, p) => s + p.units, 0))}</span>
              </div>
            );
          })}
        </div>
        {open && (
          <div className="detail">
            <div className="q"><Close onClick={() => setOpen(null)} />{open}</div>
            {gather(inTopic(open)).map((g) => {
              const first = g.items[0];
              const units = g.items.reduce((s, p) => s + p.units, 0);
              return (
                <div key={g.key} className="item">
                  <div className="kv" onClick={() => setMore(more === g.key ? null : g.key)} title="click for the notes">
                    <span>{marketOf(first)?.label ?? first.market} · {first.side === 1 ? "YES" : "NO"} {fmt(units)}{g.items.length > 1 ? ` (${g.items.length})` : ""}</span>
                    <span>{right(g)}</span>
                  </div>
                  {g.state === "pending" && (
                    <div className="kv sub">
                      <span>{first.relayed === false ? "not sent to the pot yet, retrying" : `in the pot in ${mmss(nextBatchMs() - now)} at most, sooner once ${BATCH_MIN} wait`}</span>
                      <button className="btn small danger" onClick={() => withdraw(first)} disabled={busy === first.noteId}>{busy === first.noteId ? "withdrawing…" : "withdraw"}</button>
                    </div>
                  )}
                  {more === g.key && g.items.map((p) => (
                    <div key={p.noteId} className="kv more">
                      <span>{when(p.at)} · {fmt(p.units)} MIDEN · {via(p)}</span>
                      <span>
                        {p.txId && <><a href={`${EXPLORER_URL}/tx/${p.txId}`} target="_blank" rel="noreferrer">tx {short(p.txId)}</a> · </>}
                        <a href={`${EXPLORER_URL}/note/${p.noteId}`} target="_blank" rel="noreferrer">note {short(p.noteId)}</a>
                      </span>
                    </div>
                  ))}
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
