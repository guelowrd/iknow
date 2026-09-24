import { EXPLORER_URL, ORACLE } from "@/config";
import { fmt, type Market } from "@/lib/iknow";

export function Admin({ markets }: { markets: Market[] }) {
  return (
    <section className="win admin">
      <div className="title"><span className="dot" /><span className="name">Admin</span><span className="dot" /></div>
      <div className="body">
        <table>
          <thead><tr><th>pot</th><th>yes</th><th>no</th><th>outcome</th><th>lock</th></tr></thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.id}>
                <td><a href={`${EXPLORER_URL}/account/${m.id}`} target="_blank" rel="noreferrer">{m.label}</a></td>
                <td>{fmt(m.yes)}</td><td>{fmt(m.no)}</td>
                <td>{["pending", "YES", "NO", "VOID"][m.outcome]}</td>
                <td>{m.lockHeight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>oracle <a href={`${EXPLORER_URL}/account/${ORACLE}`} target="_blank" rel="noreferrer">{ORACLE}</a></p>
        <p>
          batches, settlement and payouts run from the operator CLI:<br />
          <code>node cli.mjs pot batch --pot &lt;id&gt;</code><br />
          <code>node cli.mjs oracle publish --value &lt;post ms&gt;</code> · <code>oracle heartbeat</code><br />
          <code>node cli.mjs pot settle --pot &lt;id&gt;</code> · <code>pot payout --pot &lt;id&gt;</code>
        </p>
      </div>
    </section>
  );
}
