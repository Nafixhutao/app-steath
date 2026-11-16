// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getError, useResource } from "@/lib/resource";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useResource", () => {
  it("loads once and exposes the fetched data", async () => {
    const fetcher = vi.fn().mockResolvedValue({ name: "web" });

    const { result } = renderHook(() => useResource(fetcher, []));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ name: "web" });
    expect(result.current.error).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("turns a rejection into a readable error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Service not found."));

    const { result } = renderHook(() => useResource(fetcher, []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Service not found.");
  });

  it("flattens non-Error throws", async () => {
    const { result } = renderHook(() => useResource(async () => Promise.reject("boom"), []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("The request could not be completed.");
  });

  it("discards a slow response that resolves after a newer request", async () => {
    const first = deferred<{ generation: number }>();
    const second = deferred<{ generation: number }>();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(({ key }: { key: string }) => useResource(fetcher, [key]), {
      initialProps: { key: "a" },
    });

    // The first request is still in flight when the dependency changes and a
    // second request starts.
    rerender({ key: "b" });
    second.resolve({ generation: 2 });
    await waitFor(() => expect(result.current.data).toEqual({ generation: 2 }));

    // The stale response commits after the fresh one; the hook must drop it.
    first.resolve({ generation: 1 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.data).toEqual({ generation: 2 });
  });

  it("refresh re-runs the fetcher and replaces data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });

    const { result } = renderHook(() => useResource(fetcher, []));

    await waitFor(() => expect(result.current.data).toEqual({ count: 1 }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toEqual({ count: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("setData adopts a mutation response without a round trip", async () => {
    const fetcher = vi.fn().mockResolvedValue({ count: 1 });
    const { result } = renderHook(() => useResource(fetcher, []));
    await waitFor(() => expect(result.current.data).toEqual({ count: 1 }));

    act(() => result.current.setData({ count: 5 }));

    expect(result.current.data).toEqual({ count: 5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not fetch while disabled, then loads once enabled", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useResource(fetcher, [enabled], { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("getError", () => {
  it("prefers the Error message and answers a fallback otherwise", () => {
    expect(getError(new Error("boom"))).toBe("boom");
    expect(getError("nope")).toBe("The request could not be completed.");
  });
});
