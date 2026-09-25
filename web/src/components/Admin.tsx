import { useCallback, useEffect, useState } from "react";
import { Win } from "./Win";
import { ADMIN_URL, EXPLORER_URL, ORACLE } from "@/config";
import { fmt, OUTCOME, type Market } from "@/lib/iknow";

type PotStatus = { yesUnits: number; noUnits: number; outcome: string; vault: string; waitingNotes: number; error?: string };
type ServerPot = { id: string; topic: string; label: string; question: string; deadlineMs: number; lockHeight: number; account: string; pattern: string; status: PotStatus | null };
type ServerState = { oracle: string; pots: ServerPot[]; nextBatchMs: number; batchMin?: number };

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ADMIN_URL}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const json = (await res.json()) as { ok: boolean; result?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.result as T;
}

/** Operator view: talks to the local operator server; read-only when it is not running. */
export function Admin({ markets, onChanged }: { markets: Market[]; onChanged: () => void }) {
  const [server, setServer] = useState<ServerState | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [form, setForm] = useState({ deadline: "", topic: "", label: "", account: "", pattern: "" });
  const [resolve, setResolve] = useState({ pot: "", postId: "" });

  const refresh = useCallback(async () => {
    try {
      setServer(await api<ServerState>("/state"));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (label: string, path: string, body?: unknown) => {
    setBusy(label);
    try {
      const result = await api<unknown>(path, body);
      setLog((l) => [`${label}: ${typeof result === "object" ? JSON.stringify(result) : String(result)}`, ...l].slice(0, 8));
      await refresh();
      onChanged();
    } catch (err) {
      setLog((l) => [`${label} failed: ${err instanceof Error ? err.message : String(err)}`, ...l].slice(0, 8));
    } finally {
      setBusy(null);
    }
  };

  const pots = server?.pots ?? markets.map((m) => ({ id: m.id, topic: m.topic, label: m.label, question: m.question, deadlineMs: m.deadlineMs, lockHeight: m.lockHeight, account: "", pattern: "", status: { yesUnits: m.yes, noUnits: m.no, outcome: OUTCOME[m.outcome], vault: "", waitingNotes: 0 } }));

  return (
    <Win title="Admin" className="admin">
      <div className="body">
        {offline && <div className="hint warn">operator server offline · <code>node operator/admin.mjs</code></div>}
        <table>
          <thead><tr><th>pot</th><th>yes</th><th>no</th><th>waiting</th><th>outcome</th><th /></tr></thead>
          <tbody>
            {pots.map((p) => (
              <tr key={p.id}>
                <td><a href={`${EXPLORER_URL}/account/${p.id}`} target="_blank" rel="noreferrer" title={p.question}>{p.label}</a><div className="dim">{p.topic}</div></td>
                <td>{fmt(p.status?.yesUnits ?? 0)}</td>
                <td>{fmt(p.status?.noUnits ?? 0)}</td>
                <td>{p.status?.waitingNotes ?? "·"}</td>
                <td>{p.status?.outcome ?? "?"}</td>
                <td className="actions">
                  {!offline && <>
                    <button className="btn" disabled={!!busy} onClick={() => act(`batch ${p.label}`, "/batch", { pot: p.id })}>batch</button>
                    <button className="btn" disabled={!!busy} onClick={() => act(`settle ${p.label}`, "/settle", { pot: p.id })}>settle</button>
                    <button className="btn" disabled={!!busy} onClick={() => act(`payout ${p.label}`, "/payout", { pot: p.id })}>payout</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>oracle <a href={`${EXPLORER_URL}/account/${server?.oracle ?? ORACLE}`} target="_blank" rel="noreferrer">{server?.oracle ?? ORACLE}</a>{server && ` · next batch ${new Date(server.nextBatchMs).toLocaleTimeString()}${server.batchMin ? `, sooner once ${server.batchMin} wait` : ""}`}</p>

        {!offline && (
          <>
            <h4>New prediction pot</h4>
            <div className="form">
              <label>closes (UTC)<input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
              <label>topic<input placeholder="Will Miden Partner Mainnet be announced" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></label>
              <label>label<input placeholder="before Oct 20, 2026 (from the date if empty)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
              <label>X account id<input placeholder="1468873289267171330 (@0xMiden)" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} /></label>
              <label>regex<input placeholder="partner mainnet starts now" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} /></label>
              <button className="btn wide go" disabled={!!busy || !form.deadline} onClick={() => act("deploy", "/pots", {
                deadline: new Date(form.deadline + "Z").toISOString(), topic: form.topic || undefined, label: form.label || undefined,
                account: form.account || undefined, pattern: form.pattern || undefined,
              })}>{busy === "deploy" ? "deploying…" : "create pot"}</button>
            </div>

            <h4>Oracle</h4>
            <div className="form">
              <label>pot<select value={resolve.pot} onChange={(e) => setResolve({ ...resolve, pot: e.target.value })}><option value="">…</option>{pots.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
              <label>X post id or URL<input value={resolve.postId} onChange={(e) => setResolve({ ...resolve, postId: e.target.value })} /></label>
              <div className="controls">
                <button className="btn" disabled={!!busy || !resolve.pot || !resolve.postId} onClick={() => act("resolve", "/resolve", resolve)}>resolve from post</button>
                <button className="btn" disabled={!!busy || !resolve.pot} onClick={() => act("override now", "/publish", { pot: resolve.pot, valueMs: Date.now() })}>announced now</button>
                <button className="btn" disabled={!!busy} onClick={() => act("heartbeat", "/heartbeat")}>heartbeat</button>
              </div>
            </div>
          </>
        )}
        {log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
      </div>
    </Win>
  );
}
