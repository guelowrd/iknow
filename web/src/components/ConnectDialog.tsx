import { useState } from "react";
import { Win } from "./Win";
import { BREAD_URL } from "@/config";
import type { Session } from "@/hooks/useSession";

/** First step: Bread (recommended) or a throwaway guest wallet. */
export function ConnectDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bread = async () => {
    setBusy(true);
    setError(null);
    try {
      await session.linkBread();
      session.useBread();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const guest = () => {
    onClose();
    session.startGuest();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="connect">
      <Win title="Connect" className="dialog" onClose={onClose}>
        <div className="body">
          <div className="choice">
            {session.breadInstalled
              ? <button className="btn wide" onClick={bread} disabled={busy}>{busy ? "waiting for Bread…" : "Bread"}</button>
              : <a className="btn wide" href={BREAD_URL} target="_blank" rel="noreferrer">Bread</a>}
            <p className="small">
              Recommended: your keys stay on your device, and so do your funds and predictions.
              {!session.breadInstalled && <> Not detected in this browser. Get it at <a href={BREAD_URL} target="_blank" rel="noreferrer">miden.xyz/bread</a>.</>}
            </p>
          </div>
          <div className="choice">
            <button className="btn wide" onClick={guest} disabled={busy}>Guest</button>
            <p className="small">A throwaway wallet in this browser. Temporary: it is lost when the browser data gets cleared. Move it to Bread anytime with SAVE.</p>
          </div>
          {error && <div className="hint err">{error}</div>}
        </div>
      </Win>
    </div>
  );
}
