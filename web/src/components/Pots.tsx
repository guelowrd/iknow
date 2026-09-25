import { useEffect, useState } from "react";
import { Win } from "./Win";
import { fmt, pct, OUTCOME, type Market } from "@/lib/iknow";

type Props = { markets: Market[]; selected: number; onSelect: (i: number) => void };

const Caret = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden>{open ? <path d="M0 2 L8 2 L4 7 Z" fill="currentColor" /> : <path d="M2 0 L7 4 L2 8 Z" fill="currentColor" />}</svg>
);

/** Pots grouped by topic; a header toggles its topic, what is staked only means something per topic. */
export function Pots({ markets, selected, onSelect }: Props) {
  const topics = [...new Set(markets.map((m) => m.topic))];
  const selectedTopic = markets[selected]?.topic;
  const [closed, setClosed] = useState<string[] | null>(null); // null until the pots arrive
  useEffect(() => {
    if (closed === null && markets.length > 0) setClosed(topics.filter((t) => t !== selectedTopic)); // only the selected topic open at first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.length]);
  useEffect(() => {
    if (selectedTopic) setClosed((c) => (c?.includes(selectedTopic) ? c.filter((t) => t !== selectedTopic) : c)); // skipping to a pot shows its topic
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const isOpen = (t: string) => !(closed ?? []).includes(t);
  const toggle = (t: string) => setClosed((c) => ((c ?? []).includes(t) ? (c ?? []).filter((x) => x !== t) : [...(c ?? []), t]));

  return (
    <Win title="Prediction topics">
      <div className="body">
        <div className="list" role="listbox" aria-label="prediction topics">
          {markets.length === 0 && <div className="empty">…</div>}
          {topics.map((topic) => {
            const pots = markets.filter((m) => m.topic === topic);
            const staked = pots.reduce((s, m) => s + m.yes + m.no, 0);
            const open = isOpen(topic);
            return (
              <div key={topic} className="group">
                <div className="head" onClick={() => toggle(topic)} role="button" aria-expanded={open}>
                  <span><Caret open={open} /> {topic}</span>
                  <span className="right">{fmt(staked)} MIDEN staked</span>
                </div>
                {open && pots.map((m, j) => {
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
