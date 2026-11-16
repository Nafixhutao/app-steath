"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polling cadence and freshness, ported from stealth-forge's `api/polling`.
 * The paas data layer has no TanStack cache, so these are plain constants the
 * admin hooks read; the cadences match the source exactly.
 */

/** In-process host, database, and Redis samples behind the Overview cards. */
export const POLL_FAST_MS = 5_000;

/** API-level counters, one step behind the in-process samples. */
export const POLL_MEDIUM_MS = 15_000;

/** Overview, accounts, and incident boards. */
export const POLL_SLOW_MS = 30_000;

type ApiFailure = { error?: { code?: string; message?: string } };

/** GET one admin endpoint; throws with the API's message on failure. */
export async function adminGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
  } & ApiFailure;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The Admin API request failed.");
  }
  return payload.data as T;
}

/** POST/PUT/DELETE one admin endpoint with a JSON body. */
export async function adminSend<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
  } & ApiFailure;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The Admin API request failed.");
  }
  return payload.data as T;
}

/**
 * The slice of TanStack's UseQueryResult the ported components read: status
 * flags, data, error, and refetch. Implemented over plain fetch + polling so
 * no query library is introduced.
 */
export interface AdminQuery<T> {
  data: T | undefined;
  error: Error | null;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
}

/**
 * A polled GET with TanStack-compatible flags. `keepPrevious` holds the last
 * good payload across failed refetches, like `placeholderData:
 * keepPreviousData`.
 */
export function usePolledQuery<T>(
  path: string,
  intervalMs: number | false,
  keepPrevious = false,
): AdminQuery<T> {
  const [state, setState] = useState<{
    data: T | undefined;
    error: Error | null;
    loading: boolean;
  }>({ data: undefined, error: null, loading: true });
  const keepRef = useRef<T | undefined>(undefined);
  const ticketRef = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++ticketRef.current;
    try {
      const data = await adminGet<T>(path);
      if (ticketRef.current !== ticket) return;
      keepRef.current = data;
      setState({ data, error: null, loading: false });
    } catch (error) {
      if (ticketRef.current !== ticket) return;
      setState((current) => ({
        data: keepPrevious ? current.data : undefined,
        error:
          error instanceof Error ? error : new Error("The request failed."),
        loading: false,
      }));
    }
  }, [path, keepPrevious]);

  useEffect(() => {
    void load();
    if (typeof intervalMs !== "number" || intervalMs <= 0) return;
    const timer = window.setInterval(() => void load(), intervalMs);
    return () => window.clearInterval(timer);
  }, [load, intervalMs]);

  return {
    data: state.data,
    error: state.error,
    isPending: state.loading && state.data === undefined,
    isError: state.error !== null,
    isFetching: state.loading,
    refetch: load,
  };
}
