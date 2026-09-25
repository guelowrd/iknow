import { Win } from "./Win";
import { fmt, pct, OUTCOME, type Market } from "@/lib/iknow";

type Props = { markets: Market[]; selected: number; onSelect: (i: number) => void };

/** Pots grouped by topic; what is staked only means something per topic. */
export function Pots({ markets, selected, onSelect }: Props) {
  const topics = [...new Set(markets.map((m) => m.topic))];
  return (
    <Win title="Prediction pots">
      <div className="body">
        <div className="list" role="listbox" aria-label="prediction pots">
          {markets.length === 0 && <div className="empty">…</div>}
          {topics.map((topic) => {
            const pots = markets.filter((m) => m.topic === topic);
            const staked = pots.reduce((s, m) => s + m.yes + m.no, 0);
            return (
              <div key={topic} className="group">
                <div className="head"><span>{topic}</span><span className="right">{fmt(staked)} MIDEN staked</span></div>
                {pots.map((m, j) => {
                  const i = markets.indexOf(m);
                  return (
                    <div key={m.id} className={`row${i === selected ? " sel" : ""}`} role="option" aria-selected={i === selected} onClick={() => onSelect(i)}>
                      <span>{j + 1}.</span>
                      <span>{m.label}{m.outcome ? ` · ${OUTCOME[m.outcome]}` : ""}</span>
                      <span className="right hide-sm">{m.yes + m.no ? `${pct(m.yes, m.no)}% yes` : "·"}</span>
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
