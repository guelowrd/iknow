import { useState } from "react";
import { Close, Win } from "./Win";
import { BATCH_MIN, EXPLORER_URL } from "@/config";
import { fmt, mmss, nextBatchMs, parseId, payoutIfWins, short, type Market, type Position } from "@/lib/iknow";
import { useNow } from "@/hooks/useNow";

type State = NonNullable<Position["state"]>;
const STATE_LABEL: Record<State, string> = { pending: "next batch", in: "in pot", won: "won", lost: "lost", paid: "paid", refund: "refunded" };
const LED_ORDER: State[] = ["pending", "won", "paid", "in", "refund", "lost"]; // what a topic's LED shows first
const SETTLED: State[] = ["won", "paid", "lost", "refund"];

type Props = { positions: Position[]; markets: Market[]; onWithdraw: (p: Position) => Promise<void>; connected: boolean; guestId: string | null };
type Group = { key: string; items: Position[]; state: State };

const stateOf = (p: Position): State => p.state ?? "pending";
const units = (ps: Position[]) => ps.reduce((s, p) => s + p.units, 0);
const signed = (n: number) => `${n < 0 ? "−" : "+"}${fmt(Math.abs(n))}`;
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const explorer = (kind: "tx" | "note", id: string) => <a href={`${EXPLORER_URL}/${kind}/${id}`} target="_blank" rel="noreferrer">{kind} {short(id)}</a>;

/** Same pot, side and state gather into one line; pending ones stay apart (each can be withdrawn). */
function gather(ps: Position[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of ps) {
    const state = stateOf(p);
    const key = state === "pending" ? `pending:${p.noteId}` : `${p.market}:${p.side}:${state}`;
    const g = map.get(key) ?? { key, items: [], state };
    g.items.push(p);
    map.set(key, g);
  }
  return [...map.values()];
}

/** One row per topic with its state and net result; the detail gathers that topic's predictions,
 * each line opening its notes, paid ones listing their payout. */
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
  /** What a position got back once its pot settled (whole tokens). */
  const back = (p: Position) => { const m = marketOf(p); const s = stateOf(p); return s === "refund" ? p.units : (s === "won" || s === "paid") && m ? payoutIfWins(p, m) : 0; };
  const net = (ps: Position[]) => { const s = ps.filter((p) => SETTLED.includes(stateOf(p))); return { settled: s.length > 0, back: s.reduce((t, p) => t + back(p), 0), net: s.reduce((t, p) => t + back(p), 0) - units(s) }; };
  // live topics first in the order of the topics window, then settled ones, latest settlement first
  const isLive = (topic: string) => positions.some((p) => topicOf(p) === topic && !marketOf(p)?.outcome);
  const settledAt = (topic: string) => Math.max(...positions.filter((p) => topicOf(p) === topic).map((p) => marketOf(p)?.settledAt ?? marketOf(p)?.deadlineMs ?? 0));
  const order = (topic: string) => markets.findIndex((m) => m.topic === topic);
  const topics = [...new Set(positions.map(topicOf))].sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || (isLive(a) ? order(a) - order(b) : settledAt(b) - settledAt(a)));
  const inTopic = (topic: string) => positions.filter((p) => topicOf(p) === topic).sort((a, b) => Number(stateOf(b) === "pending") - Number(stateOf(a) === "pending") || potIndex(a) - potIndex(b) || a.side - b.side || b.at - a.at);
  /** The topic in a few words: "2 pending · 5 in pot", or "won 10 · lost 1 · net +8". */
  const story = (ps: Position[]) => {
    const by = (s: State) => ps.filter((p) => stateOf(p) === s);
    const parts: string[] = [];
    if (by("pending").length) parts.push(`${fmt(units(by("pending")))} pending`);
    if (by("in").length) parts.push(`${fmt(units(by("in")))} in pot`);
    const won = [...by("won"), ...by("paid")];
    if (won.length) parts.push(`won ${fmt(won.reduce((s, p) => s + back(p), 0))}`);
    if (by("refund").length) parts.push(`refunded ${fmt(units(by("refund")))}`);
    if (by("lost").length) parts.push(`lost ${fmt(units(by("lost")))}`);
    const n = net(ps);
    if (n.settled) parts.push(`net ${signed(n.net)}`);
    return parts.join(" · ");
  };
  const led = (ps: Position[]) => LED_ORDER.find((s) => ps.some((p) => stateOf(p) === s)) ?? "in";

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

  const amount = (g: Group) => {
    const m = marketOf(g.items[0]);
    const pays = m ? g.items.reduce((s, p) => s + payoutIfWins(p, m), 0) : 0;
    if (g.state === "in" && m) return `pays ${fmt(pays)} if it wins`;
    if ((g.state === "won" || g.state === "paid") && m) return `${fmt(pays)} MIDEN`;
    if (g.state === "refund") return `${fmt(units(g.items))} MIDEN back`;
    if (g.state === "lost") return `−${fmt(units(g.items))}`;
    return "";
  };

  const detail = (topic: string) => {
    const ps = inTopic(topic);
    const n = net(ps);
    return (
      <div className="detail">
        <div className="q"><Close onClick={() => setOpen(null)} />{topic}</div>
        <div className="kv sum"><span>staked {fmt(units(ps))}</span><span>{n.settled ? `got back ${fmt(n.back)} · net ${signed(n.net)}` : story(ps)}</span></div>
        {gather(ps).map((g) => {
          const first = g.items[0];
          return (
            <div key={g.key} className="item">
              <div className="kv" onClick={() => setMore(more === g.key ? null : g.key)} title="click for the notes">
                <span>{marketOf(first)?.label ?? first.market} · {first.side === 1 ? "YES" : "NO"} {fmt(units(g.items))}{g.items.length > 1 ? ` (${g.items.length})` : ""}</span>
                <span><span className={`state ${g.state}`}>{STATE_LABEL[g.state]}</span>{amount(g) ? ` · ${amount(g)}` : ""}</span>
              </div>
              {g.state === "pending" && (
                <div className="kv sub">
                  <span>{first.relayed === false ? "not sent to the pot yet, retrying" : `in the pot in ${mmss(nextBatchMs() - now)} at most, sooner once ${BATCH_MIN} wait`}</span>
                  <button className="btn small danger" onClick={() => withdraw(first)} disabled={busy === first.noteId}>{busy === first.noteId ? "withdrawing…" : "withdraw"}</button>
                </div>
              )}
              {g.state === "won" && <div className="kv sub"><span>payout on its way: the pot pays at the next 10-minute mark</span></div>}
              {(g.state === "paid" || g.state === "refund") && g.items.filter((p) => p.payout).map((p) => (
                <div key={`payout:${p.noteId}`} className="kv more">
                  <span>paid {when(p.payout!.at)} · {fmt(back(p))} MIDEN · to {via(p)}</span>
                  <span>{p.payout!.tx && <>{explorer("tx", p.payout!.tx)} · </>}{explorer("note", p.payout!.note)}</span>
                </div>
              ))}
              {more === g.key && g.items.map((p) => (
                <div key={p.noteId} className="kv more">
                  <span>{when(p.at)} · {fmt(p.units)} MIDEN · {via(p)}</span>
                  <span>{p.txId && <>{explorer("tx", p.txId)} · </>}{explorer("note", p.noteId)}</span>
                </div>
              ))}
            </div>
          );
        })}
        {error && <div className="hint err">{error}</div>}
      </div>
    );
  };

  return (
    <Win title="My predictions">
      <div className="body">
        <div className="list">
          {positions.length === 0 && <div className="empty">{connected ? "none yet · pick a pot and press iKnow" : "connect to see your predictions"}</div>}
          {topics.map((topic) => {
            const ps = inTopic(topic);
            return (
              <div key={topic} className={`row${open === topic ? " sel" : ""}`} onClick={() => setOpen(open === topic ? null : topic)}>
                <span><i className={`led ${led(ps)}`} /></span>
                <span>{marketOf(ps[0])?.short ?? topic}</span>
                <span className="right hide-sm">{story(ps)}</span>
                <span className="right">{fmt(units(ps))}</span>
              </div>
            );
          })}
        </div>
        {open && detail(open)}
      </div>
    </Win>
  );
}
