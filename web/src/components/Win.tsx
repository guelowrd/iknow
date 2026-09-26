import { useState, type ReactNode } from "react";

type Props = { title?: string; bar?: ReactNode; children: ReactNode; className?: string; onClose?: () => void; shaded?: boolean };

/** Close cross, top left like every window people know. */
export const Close = ({ onClick }: { onClick: () => void }) => (
  <button className="close" onClick={onClick} aria-label="close">
    <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden><path d="M1 1 L7 7 M7 1 L1 7" stroke="currentColor" strokeWidth="1.6" /></svg>
  </button>
);

/** A window: title bar and body. A double-click on the title shades it, Winamp style; a window
 * with onClose (a dialog) gets the close cross instead. */
export function Win({ title, bar, children, className, onClose, shaded: shadedAtFirst = false }: Props) {
  const [shaded, setShaded] = useState(shadedAtFirst);
  return (
    <section className={`win${shaded ? " shade" : ""}${className ? ` ${className}` : ""}`}>
      <div className="title" onDoubleClick={onClose ? undefined : () => setShaded((s) => !s)} title={onClose ? undefined : "double-click to shade"}>
        {onClose && <Close onClick={onClose} />}
        {bar ?? <span className="name">{title}</span>}
        {onClose && <span className="spacer" />}
      </div>
      {!shaded && children}
    </section>
  );
}
