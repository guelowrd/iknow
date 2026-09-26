import { Win } from "./Win";
import { dateLabel, fmt, multiple, OUTCOME, type Market } from "@/lib/iknow";

type Props = { markets: Market[]; selected: number; onSelect: (i: number) => void };

/** Settled pots by topic, newest settlement first: the outcome comes first, then what the pool paid.
 * Shaded until wanted (double-click the title). */
export function Resolved({ markets, selected, onSelect }: Props) {
  const resolved = markets.filter((m) => m.outcome);
  const latest = (topic: string) => Math.max(...resolved.filter((m) => m.topic === topic).map((m) => m.settledAt ?? m.deadlineMs));
  const topics = [...new Set(resolved.map((m) => m.topic))].sort((a, b) => latest(b) - latest(a));
  return (
    <Win title="Resolved predictions" shaded>
      <div className="body">
        <div className="list resolved" role="listbox" aria-label="resolved predictions">
          {resolved.length === 0 && <div className="empty">none yet</div>}
          {topics.map((topic) => {
            const pots = resolved.filter((m) => m.topic === topic);
            return (
              <div key={topic} className="group">
                <div className="head"><span>{topic}</span><span className="right">{pots.length} pot{pots.length > 1 ? "s" : ""}</span></div>
                {pots.map((m) => {
                  const i = markets.indexOf(m);
                  const o = OUTCOME[m.outcome];
                  return (
                    <div key={m.id} className={`row${i === selected ? " sel" : ""}`} role="option" aria-selected={i === selected} onClick={() => onSelect(i)}>
                      <span className={`out ${o.toLowerCase()}`}>{o}</span>
                      <span>{m.label}</span>
                      <span className="right hide-sm">{m.outcome === 3 ? "refunded" : `${o} paid ${multiple(m)}`}{m.settledAt ? ` · ${dateLabel(m.settledAt)}` : ""}</span>
                      <span className="right">{fmt(m.yes + m.no)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Win>
  );
}
