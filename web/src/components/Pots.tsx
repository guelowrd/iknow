import { Win } from "./Win";
import { fmt, pct, shortTitle, OUTCOME, type Market } from "@/lib/iknow";

export function Pots({ markets, selected, onSelect }: { markets: Market[]; selected: number; onSelect: (i: number) => void }) {
  const total = markets.reduce((s, m) => s + m.yes + m.no, 0);
  return (
    <Win title="Prediction pots">
      <div className="body">
        <div className="list" role="listbox" aria-label="prediction pots">
          {markets.map((m, i) => (
            <div key={m.id} className={`row${i === selected ? " sel" : ""}`} role="option" aria-selected={i === selected} onClick={() => onSelect(i)}>
              <span>{i + 1}.</span>
              <span>{shortTitle(m.question)}{m.outcome ? ` · ${OUTCOME[m.outcome]}` : ""}</span>
              <span className="right hide-sm">{m.yes + m.no ? `${pct(m.yes, m.no)}% yes` : "·"}</span>
              <span className="right">{fmt(m.yes + m.no)}</span>
            </div>
          ))}
        </div>
        <div className="footer"><span>{markets.length} pots</span><span>{fmt(total)} MIDEN staked</span></div>
      </div>
    </Win>
  );
}
