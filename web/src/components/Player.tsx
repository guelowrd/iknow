import { useEffect, useRef, useState } from "react";
import { Win } from "./Win";
import { fmt, nextBatchMs, pct, short, type Market } from "@/lib/iknow";
import type { Session } from "@/hooks/useSession";
import type { PredictStatus } from "@/hooks/usePrediction";
import { useAudio } from "@/hooks/useAudio";

type Props = {
  market: Market | null;
  index: number;
  count: number;
  session: Session;
  prediction: { status: PredictStatus; error: string | null; predict: (m: Market, side: 1 | 2, units: number) => Promise<void>; reset: () => void };
  onPrev: () => void;
  onNext: () => void;
  onSave: () => void;
  onConnect: () => void;
};

const BARS = 24;

function remaining(ms: number) {
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function mmss(ms: number) {
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Bars split by the YES / NO share: still when silent, driven by the music when playing. */
function Spectrum({ yes, no, analyser, playing }: { yes: number; no: number; analyser: AnalyserNode | null; playing: boolean }) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const share = pct(yes, no) / 100;
  const yesBars = Math.round(BARS * share);
  useEffect(() => {
    if (!playing || !analyser) {
      refs.current.forEach((el, i) => {
        if (!el) return;
        const isYes = i < yesBars;
        const h = yes + no === 0 ? 12 : isYes ? 30 + 70 * share : 30 + 70 * (1 - share);
        el.style.height = `${Math.round(h)}%`;
      });
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const draw = () => {
      analyser.getByteFrequencyData(data);
      refs.current.forEach((el, i) => {
        if (!el) return;
        const v = data[Math.min(data.length - 1, i)] / 255;
        el.style.height = `${Math.max(4, Math.round(v * 100))}%`;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, analyser, yes, no, share, yesBars]);
  return (
    <div className="spectrum" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => <i key={i} ref={(el) => { refs.current[i] = el; }} className={i < yesBars ? "y" : "n"} />)}
    </div>
  );
}

function WalletChip({ session, onSave, onConnect }: { session: Session; onSave: () => void; onConnect: () => void }) {
  if (session.mode === "bread" && session.address) return <span className="chip"><i className="dot on" /><span className="addr">{short(session.address)}</span><button onClick={session.disconnect}>×</button></span>;
  if (session.mode === "guest") {
    return (
      <span className="chip">
        <i className={`dot${session.address ? " on" : ""}`} />guest <span className="addr">{session.address ? short(session.address) : session.guestStep}</span>
        {(session.balance ?? 0) >= 1 && <button className="save" onClick={onSave}>SAVE</button>}
        <button onClick={session.disconnect}>×</button>
      </span>
    );
  }
  return <span className="chip"><button onClick={onConnect} disabled={session.breadConnecting}>{session.breadConnecting ? "connecting…" : "connect"}</button></span>;
}

const SkipBack = () => <svg viewBox="0 0 16 10" width="16" height="10" aria-hidden><rect x="0" y="0" width="2" height="10" fill="currentColor" /><path d="M9 0 L3 5 L9 10 Z M16 0 L10 5 L16 10 Z" fill="currentColor" /></svg>;
const SkipForward = () => <svg viewBox="0 0 16 10" width="16" height="10" aria-hidden><path d="M0 0 L6 5 L0 10 Z M7 0 L13 5 L7 10 Z" fill="currentColor" /><rect x="14" y="0" width="2" height="10" fill="currentColor" /></svg>;

export function Player({ market, index, count, session, prediction, onPrev, onNext, onSave, onConnect }: Props) {
  const [staking, setStaking] = useState(false);
  const [units, setUnits] = useState(1);
  const audio = useAudio();
  const max = Math.max(1, Math.min(session.balance ?? 1, 1000));
  const canPredict = !!market && !market.outcome && !!session.address && (session.balance ?? 0) >= 1;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (prediction.status === "sent") {
      const t = setTimeout(() => { setStaking(false); prediction.reset(); }, 4_000);
      return () => clearTimeout(t);
    }
  }, [prediction.status, prediction]);

  const busy = prediction.status === "building" || prediction.status === "signing" || prediction.status === "relaying";
  const ticker = market
    ? `next batch in ${mmss(nextBatchMs())}  ·  ${market.outcome ? `resolved ${["", "YES", "NO", "VOID"][market.outcome]}` : `resolves by ${market.label}, ${remaining(market.deadlineMs)} at most`}`
    : "…";
  const hint = (() => {
    if (prediction.status === "error") return <div className="hint err">{prediction.error}</div>;
    if (prediction.status === "building") return <div className="hint">building note…</div>;
    if (prediction.status === "signing") return <div className="hint">{session.mode === "bread" ? "confirm in Bread…" : "proving…"}</div>;
    if (prediction.status === "relaying") return <div className="hint">sending to pot…</div>;
    if (prediction.status === "sent") return <div className="hint">✓ in the next batch</div>;
    if (session.error) return <div className="hint err">{session.error}</div>;
    if (session.mode === "guest" && session.guestStep !== "ready") return <div className="hint">guest wallet: {session.guestStep}…</div>;
    if (!session.address) return <div className="hint">connect to play</div>;
    if (market?.outcome) return <div className="hint warn">closed · {["", "YES", "NO", "VOID"][market.outcome]}</div>;
    if ((session.balance ?? 0) < 1) return <div className="hint warn">no MIDEN in this wallet</div>;
    return null;
  })();

  const bar = (
    <>
      <button className={`dot play${audio.playing ? " on" : ""}`} onClick={audio.toggle} aria-label={audio.playing ? "stop music" : "play music"} title={audio.playing ? "stop" : "play"} />
      <span className="name"><WalletChip session={session} onSave={onSave} onConnect={onConnect} /></span>
      <span className="spacer" />
    </>
  );

  return (
    <Win bar={bar}>
      <div className="body">
        <div className="lcd" aria-live="polite">
          <div className="marquee"><span>{[0, 1].map((i) => <span key={i}>{ticker}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>)}</span></div>
          <div className="question">{market?.question ?? "…"}</div>
          {staking && market ? (
            <div className="stats"><span className="big">{fmt(units)}<small>MIDEN</small></span><span className="dim">of {fmt(session.balance ?? 0)}</span></div>
          ) : (
            <div className="stats">
              <span className="yes">YES {market ? pct(market.yes, market.no) : 50}%</span>
              <span className="no">NO {market ? 100 - pct(market.yes, market.no) : 50}%</span>
              <span className="dim">{fmt(market ? market.yes + market.no : 0)} MIDEN staked</span>
            </div>
          )}
          <Spectrum yes={market?.yes ?? 0} no={market?.no ?? 0} analyser={audio.analyser} playing={audio.playing} />
          {hint}
        </div>

        {staking && market ? (
          <>
            <div className="slider">
              <input type="range" min={1} max={max} value={Math.min(units, max)} onChange={(e) => setUnits(Number(e.target.value))} disabled={busy} aria-label="stake in MIDEN" />
              <span className="amount">{fmt(Math.min(units, max))} MIDEN</span>
            </div>
            <div className="controls">
              <button className="btn" onClick={() => { setStaking(false); prediction.reset(); }} disabled={busy} aria-label="cancel">✕</button>
              <button className="btn yes" onClick={() => prediction.predict(market, 1, Math.min(units, max))} disabled={busy || !canPredict}>YES</button>
              <button className="btn no" onClick={() => prediction.predict(market, 2, Math.min(units, max))} disabled={busy || !canPredict}>NO</button>
            </div>
          </>
        ) : (
          <div className="controls">
            <button className="btn" onClick={onPrev} disabled={index <= 0} aria-label="previous pot"><SkipBack /></button>
            <button className="btn wide go" onClick={() => setStaking(true)} disabled={!canPredict}>iKnow</button>
            <button className="btn" onClick={onNext} disabled={index >= count - 1} aria-label="next pot"><SkipForward /></button>
          </div>
        )}
      </div>
    </Win>
  );
}
