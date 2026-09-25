import { BREAD_URL } from "@/config";
import type { Session } from "@/hooks/useSession";

/** First step: pick Bread (recommended) or a throwaway guest wallet. */
export function ConnectDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const pick = async (fn: () => Promise<void>) => {
    onClose();
    await fn();
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="connect">
      <section className="win dialog">
        <div className="title"><span className="name">Connect</span></div>
        <div className="body">
          <div className="choice">
            {session.breadInstalled
              ? <button className="btn wide go" onClick={() => pick(session.connectBread)} disabled={session.breadConnecting}>{session.breadConnecting ? "connecting…" : "Bread Wallet"}</button>
              : <a className="btn wide go" href={BREAD_URL} target="_blank" rel="noreferrer">get Bread Wallet</a>}
            <p className="small">Recommended. Your keys stay on your device, your funds and predictions with them.</p>
          </div>
          <div className="choice">
            <button className="btn wide" onClick={() => pick(session.startGuest)}>Guest</button>
            <p className="small">A throwaway wallet in this browser, funded with testnet MIDEN. Lost if the browser data goes. Move it to Bread with SAVE anytime.</p>
          </div>
          <div className="controls"><button className="btn" onClick={onClose}>later</button></div>
        </div>
      </section>
    </div>
  );
}
