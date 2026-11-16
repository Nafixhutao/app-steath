"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The one state machine behind every dashboard and admin panel: data arrives
 * from the API, a failure is a human-readable message, and a refetch replaces
 * both. Every panel used to re-derive this by hand — 15 copies of the same
 * `useState`/`useCallback`/`useEffect` trio — and none of them guarded against
 * a slow response from a previous page overwriting the current one. The hook
 * orders responses with a ticket, like the admin console's `usePolledQuery`.
 */

/** Flattens any thrown value to the message a panel renders. */
export function getError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export type Resource<T> = {
  data: T | null;
  /** True until the first response arrives, however it answers. */
  loading: boolean;
  error: string;
  /** Re-runs the fetcher; safe to call after a mutation. */
  refresh: () => Promise<void>;
  /**
   * Stores a value without a round trip — the common case is a panel adopting
   * the object a mutation just returned instead of refetching the world.
   */
  setData: (data: T) => void;
};

export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  options: { enabled?: boolean } = {},
): Resource<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ticketRef = useRef(0);

  const load = useCallback(
    async () => {
      if (!enabled) return;

      // A response from a request that started before the newest one is stale:
      // the user may have navigated or the deps may have changed. Only the
      // newest ticket may commit state.
      const ticket = ++ticketRef.current;
      try {
        const result = await fetcher();
        if (ticketRef.current !== ticket) return;
        setData(result);
        setError("");
      } catch (cause) {
        if (ticketRef.current !== ticket) return;
        setError(getError(cause));
      } finally {
        if (ticketRef.current === ticket) setLoading(false);
      }
    },
    // The fetcher is re-created by the caller on every render; `deps` is the
    // real identity. Exactly what useCallback/useEffect callers pass today.
    // eslint-disable-next-line -- spread is the point
    [...deps] as React.DependencyList,
  );

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return {
    data,
    loading,
    error,
    refresh: load,
    setData: useCallback((next: T) => setData(next), []),
  };
}
