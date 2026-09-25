import { useEffect, useState } from "react";

/** The current time, refreshed every second, for countdowns. */
export function useNow(everyMs = 1_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
