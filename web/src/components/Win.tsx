import { useState, type ReactNode } from "react";

/** A window: title bar (double-click shades it, Winamp style) and a body. */
export function Win({ title, bar, children, className }: { title?: string; bar?: ReactNode; children: ReactNode; className?: string }) {
  const [shaded, setShaded] = useState(false);
  return (
    <section className={`win${shaded ? " shade" : ""}${className ? ` ${className}` : ""}`}>
      <div className="title" onDoubleClick={() => setShaded((s) => !s)} title="double-click to shade">
        {bar ?? <span className="name">{title}</span>}
      </div>
      {!shaded && children}
    </section>
  );
}
