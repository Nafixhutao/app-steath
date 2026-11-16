"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Seconds since mount or the last reset — drives "Last updated Xs ago". */
export function useElapsedSeconds(resetKey?: unknown): {
  seconds: number;
  reset: () => void;
} {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(0);

  const reset = useCallback(() => {
    startRef.current = Date.now();
    setSeconds(0);
  }, []);

  useEffect(() => {
    startRef.current = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verbatim from stealth-forge
    setSeconds(0);
  }, [resetKey]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return { seconds, reset };
}
