import type { Market, Position } from "@/lib/iknow";
import { fmt } from "@/lib/iknow";

const STATE_LABEL: Record<NonNullable<Position["state"]>, string> = {
  pending: "next batch",
  in: "in pot",
  won: "won",
  lost: "lost",
  paid: "paid",
  refund: "refund",
};

export function MyBets({ positions, markets }: { positions: Position[]; markets: Market[] }) {
  const label = (id: string) => markets.find((m) => m.id === id)?.label ?? "?";
  return (
    <section className="win">
      <div className="title"><span className="dot" /><span className="name">My bets</span><span className="dot" /></div>
      <div className="body">
        <div className="list">
          {positions.length === 0 && <div className="empty">none yet</div>}
          {positions.map((p) => (
            <div key={p.noteId} className="row" style={{ cursor: "default" }}>
              <span><i className={`led ${p.state ?? "pending"}`} /></span>
              <span>{label(p.market)} · {p.side === 1 ? "YES" : "NO"}</span>
              <span className="right hide-sm">{STATE_LABEL[p.state ?? "pending"]}</span>
              <span className="right">{fmt(p.units)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
