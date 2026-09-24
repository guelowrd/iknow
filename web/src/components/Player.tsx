import { useEffect, useMemo, useState } from "react";
import { QUESTION, X_ACCOUNT } from "@/config";
import { fmt, pct, short, type Market } from "@/lib/iknow";
import type { Session } from "@/hooks/useSession";
import type { BetStatus } from "@/hooks/useBet";

type Props = {
  market: Market | null;
  index: number;
  count: number;
  session: Session;
  bet: { status: BetStatus; error: string | null; placeBet: (m: Market, side: 1 | 2, units: number) => Promise<void>; reset: () => void };
  onPrev: () => void;
  onNext: () => void;
};

function countdown(ms: number) {
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function Spectrum({ yes, no }: { yes: number; no: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 380);
    return () => clearInterval(t);
  }, []);
  const share = pct(yes, no) / 100;
  const bars = useMemo(() => {
    const total = yes + no;
    return Array.from({ length: 24 }, (_, i) => {
      const isYes = i < Math.round(24 * share);
      const base = total === 0 ? 0.15 : isYes ? 0.35 + 0.6 * share : 0.35 + 0.6 * (1 - share);
      const jitter = ((Math.sin((i + 1) * 12.9898 + tick * 1.7) + 1) / 2) * 0.35;
      return { h: Math.min(1, base * (0.65 + jitter)), isYes };
    });
  }, [yes, no, share, tick]);
  return (
    <div className="spectrum" aria-hidden>
      {bars.map((b, i) => <i key={i} className={b.isYes ? "y" : "n"} style={{ height: `${Math.round(b.h * 100)}%` }} />)}
    </div>
  );
}

function WalletChip({ session }: { session: Session }) {
  if (session.mode === "bread" && session.address) return <span className="chip"><i className="dot on" /><span className="addr">{short(session.address)}</span><button onClick={session.disconnect}>×</button></span>;
  if (session.mode === "guest") return <span className="chip"><i className={`dot${session.address ? " on" : ""}`} />guest <span className="addr">{session.address ? short(session.address) : session.guestStep}</span><button onClick={session.disconnect}>×</button></span>;
  return (
    <span className="chip">
      {session.breadInstalled
        ? <button onClick={session.connectBread} disabled={session.breadConnecting}>{session.breadConnecting ? "…" : "Bread"}</button>
        : <a href="https://www.miden.xyz/wallet" target="_blank" rel="noreferrer">get Bread</a>}
      <span>·</span>
      <button onClick={session.startGuest}>guest</button>
    </span>
  );
}

export function Player({ market, index, count, session, bet, onPrev, onNext }: Props) {
  const [staking, setStaking] = useState(false);
  const [units, setUnits] = useState(1);
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
        <span className="dot on" />
        <span className="name">iKnow</span>
        <WalletChip session={session} />
      </div>
      <div className="body">
        <div className="lcd" aria-live="polite">
          <div className="marquee"><span>{[0, 1].map((i) => <span key={i}>{X_ACCOUNT} posts “{QUESTION}” before {market?.label ?? "…"}?&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>)}</span></div>
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
          {market && <Spectrum yes={market.yes} no={market.no} />}
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
            <button className="btn" onClick={onPrev} disabled={index <= 0} aria-label="previous market">◀◀</button>
            <button className="btn wide go" onClick={() => setStaking(true)} disabled={!canBet}>iKnow</button>
            <button className="btn" onClick={onNext} disabled={index >= count - 1} aria-label="next market">▶▶</button>
          </div>
        )}
      </div>
    </section>
  );
}
