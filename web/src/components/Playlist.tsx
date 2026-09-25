import type { Market } from "@/lib/iknow";
import { fmt, marketTitle, pct } from "@/lib/iknow";

export function Playlist({ markets, selected, onSelect }: { markets: Market[]; selected: number; onSelect: (i: number) => void }) {
  const total = markets.reduce((s, m) => s + m.yes + m.no, 0);
  return (
    <section className="win">
      <div className="title"><span className="dot" /><span className="name">Playlist</span><span className="dot" /></div>
      <div className="body">
        <div className="list" role="listbox" aria-label="markets">
          {markets.map((m, i) => (
            <div key={m.id} className={`row${i === selected ? " sel" : ""}`} role="option" aria-selected={i === selected} onClick={() => onSelect(i)}>
              <span>{i + 1}.</span>
              <span>{marketTitle(m)}{m.outcome ? ` · ${["", "YES", "NO", "VOID"][m.outcome]}` : ""}</span>
              <span className="right hide-sm">{m.yes + m.no ? `${pct(m.yes, m.no)}% yes` : "·"}</span>
              <span className="right">{fmt(m.yes + m.no)}</span>
            </div>
          ))}
        </div>
        <div className="footer"><span>{markets.length} markets</span><span>{fmt(total)} MIDEN in play</span></div>
      </div>
    </section>
  );
}
