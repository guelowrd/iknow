import { useEffect, useRef, useState } from "react";
import { fmt, marketTitle, pct, short, type Market } from "@/lib/iknow";
import type { Session } from "@/hooks/useSession";
import type { BetStatus } from "@/hooks/useBet";
import { useAudio } from "@/hooks/useAudio";

type Props = {
  market: Market | null;
  index: number;
  count: number;
  session: Session;
  bet: { status: BetStatus; error: string | null; placeBet: (m: Market, side: 1 | 2, units: number) => Promise<void>; reset: () => void };
  onPrev: () => void;
  onNext: () => void;
};

const BARS = 24;

function countdown(ms: number) {
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

function WalletChip({ session }: { session: Session }) {
  if (session.mode === "bread" && session.address) return <span className="chip"><i className="dot on" /><span className="addr">{short(session.address)}</span><button onClick={session.disconnect}>×</button></span>;
  if (session.mode === "guest") return <span className="chip"><i className={`dot${session.address ? " on" : ""}`} />guest <span className="addr">{session.address ? short(session.address) : session.guestStep}</span><button onClick={session.disconnect}>×</button></span>;
  return (
    <span className="chip">
      {session.breadInstalled
        ? <button onClick={session.connectBread} disabled={session.breadConnecting}>{session.breadConnecting ? "…" : "connect Bread"}</button>
        : <a href="https://www.miden.xyz/wallet" target="_blank" rel="noreferrer">get Bread</a>}
      <span>·</span>
      <button onClick={session.startGuest}>guest</button>
    </span>
  );
}

const SkipBack = () => <svg viewBox="0 0 16 10" width="16" height="10" aria-hidden><rect x="0" y="0" width="2" height="10" fill="currentColor" /><path d="M9 0 L3 5 L9 10 Z M16 0 L10 5 L16 10 Z" fill="currentColor" /></svg>;
const SkipForward = () => <svg viewBox="0 0 16 10" width="16" height="10" aria-hidden><path d="M0 0 L6 5 L0 10 Z M7 0 L13 5 L7 10 Z" fill="currentColor" /><rect x="14" y="0" width="2" height="10" fill="currentColor" /></svg>;

export function Player({ market, index, count, session, bet, onPrev, onNext }: Props) {
  const [staking, setStaking] = useState(false);
  const [units, setUnits] = useState(1);
  const audio = useAudio();
  const max = Math.max(1, Math.min(session.balance ?? 1, 1000));
  const canBet = !!market && !market.outcome && !!session.address && (session.balance ?? 0) >= 1;
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (bet.status === "sent") {
      const t = setTimeout(() => { setStaking(false); bet.reset(); }, 4_000);
      return () => clearTimeout(t);
    }
  }, [bet.status, bet]);

  const busy = bet.status === "building" || bet.status === "signing" || bet.status === "relaying";
  const title = market ? marketTitle(market) : "…";
  const hint = (() => {
    if (bet.status === "error") return <div className="hint err">{bet.error}</div>;
    if (bet.status === "building") return <div className="hint">building note…</div>;
    if (bet.status === "signing") return <div className="hint">{session.mode === "bread" ? "confirm in Bread…" : "proving…"}</div>;
    if (bet.status === "relaying") return <div className="hint">sending to pot…</div>;
    if (bet.status === "sent") return <div className="hint">✓ in the next batch</div>;
    if (session.error) return <div className="hint err">{session.error}</div>;
    if (session.mode === "guest" && session.guestStep !== "ready") return <div className="hint">guest wallet: {session.guestStep}…</div>;
    if (!session.address) return <div className="hint">connect to play</div>;
    if (market?.outcome) return <div className="hint warn">closed · {["", "YES", "NO", "VOID"][market.outcome]}</div>;
    if ((session.balance ?? 0) < 1) return <div className="hint warn">no MIDEN in this wallet</div>;
    return null;
  })();

  return (
    <section className="win">
      <div className="title">
        <button className={`dot play${audio.playing ? " on" : ""}`} onClick={audio.toggle} aria-label={audio.playing ? "stop music" : "play music"} title={audio.playing ? "stop" : "play"} />
        <span className="name"><WalletChip session={session} /></span>
        <span className="dot" />
      </div>
      <div className="body">
        <div className="lcd" aria-live="polite">
          <div className="marquee"><span>{[0, 1].map((i) => <span key={i}>{title}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>)}</span></div>
          {staking && market ? (
            <>
              <div className="big">{fmt(units)}<small>MIDEN</small></div>
              <div className="meta"><span className="dim">of {fmt(session.balance ?? 0)}</span><br />before {market.label}</div>
            </>
          ) : (
            <>
              <div className="big">{market ? countdown(market.deadlineMs) : "--"}<small>left</small></div>
              <div className="meta">
                <span className="yes">YES {market ? pct(market.yes, market.no) : 50}%</span><br />
                <span className="no">NO {market ? 100 - pct(market.yes, market.no) : 50}%</span><br />
                <span className="dim">{fmt(market ? market.yes + market.no : 0)} MIDEN</span>
              </div>
            </>
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
              <button className="btn" onClick={() => { setStaking(false); bet.reset(); }} disabled={busy} aria-label="cancel">✕</button>
              <button className="btn yes" onClick={() => bet.placeBet(market, 1, Math.min(units, max))} disabled={busy || !canBet}>YES</button>
              <button className="btn no" onClick={() => bet.placeBet(market, 2, Math.min(units, max))} disabled={busy || !canBet}>NO</button>
            </div>
          </>
        ) : (
          <div className="controls">
            <button className="btn" onClick={onPrev} disabled={index <= 0} aria-label="previous market"><SkipBack /></button>
            <button className="btn wide go" onClick={() => setStaking(true)} disabled={!canBet}>iKnow</button>
            <button className="btn" onClick={onNext} disabled={index >= count - 1} aria-label="next market"><SkipForward /></button>
          </div>
        )}
      </div>
    </section>
  );
}
