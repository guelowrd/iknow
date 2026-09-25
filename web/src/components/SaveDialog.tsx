import { useState } from "react";
import { Win } from "./Win";
import { BREAD_URL, UNIT } from "@/config";
import { fmt, short } from "@/lib/iknow";
import type { Session } from "@/hooks/useSession";

type Props = { session: Session; onSave: (breadAddress: string) => Promise<bigint>; onClose: () => void };

/** Moves a guest wallet's MIDEN into Bread. */
export function SaveDialog({ session, onSave, onClose }: Props) {
  const [step, setStep] = useState<"idle" | "connecting" | "moving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(0);
  const amount = Number((session.balanceRaw ?? 0n) / UNIT);

  const connect = async () => {
    setStep("connecting");
    setError(null);
    try {
      await session.linkBread();
      setStep("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };
  const move = async () => {
    if (!session.breadAddress) return;
    setStep("moving");
    setError(null);
    try {
      const units = await onSave(session.breadAddress);
      setMoved(Number(units / UNIT));
      setStep("done");
      session.useBread();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="save to Bread">
      <Win title="Save to Bread" className="dialog" onClose={onClose}>
        <div className="body">
          {step === "done" ? (
            <>
              <p className="lead">✓ {fmt(moved)} MIDEN moved to Bread {session.breadAddress ? short(session.breadAddress) : ""}</p>
              <p className="small">Bread is now your wallet here. Predictions made as a guest pay out to the guest wallet: switch back to guest and save again once they resolve.</p>
              <div className="controls"><button className="btn wide" onClick={onClose}>ok</button></div>
            </>
          ) : (
            <>
              <p className="lead">Move {fmt(amount)} MIDEN from this guest wallet to Bread.</p>
              <p className="small">The guest wallet lives only in this browser. Bread keeps your keys safe on your device. Predictions already made pay out to the guest wallet: come back and save again after they resolve.</p>
              {error && <div className="hint err">{error}</div>}
              <div className="controls">
                {!session.breadInstalled && <a className="btn wide danger" href={BREAD_URL} target="_blank" rel="noreferrer">get Bread</a>}
                {session.breadInstalled && !session.breadConnected && <button className="btn wide danger" onClick={connect} disabled={step === "connecting"}>{step === "connecting" ? "connecting…" : "connect Bread"}</button>}
                {session.breadInstalled && session.breadConnected && <button className="btn wide danger" onClick={move} disabled={step === "moving" || amount < 1}>{step === "moving" ? "moving…" : `move to ${session.breadAddress ? short(session.breadAddress) : "Bread"}`}</button>}
              </div>
            </>
          )}
        </div>
      </Win>
    </div>
  );
}
