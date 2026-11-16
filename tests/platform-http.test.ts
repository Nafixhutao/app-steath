import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transportError, request } from "@/lib/platform/http";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("request", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps the data envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: { name: "web" } }));

    await expect(request("/api/projects/1")).resolves.toEqual({ name: "web" });
    expect(fetch).toHaveBeenCalledWith("/api/projects/1", {
      method: "GET",
      cache: undefined,
      headers: undefined,
      body: undefined,
    });
  });

  it("serializes a JSON body and drops the header when there is none", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: { id: "s1" } }));

    await request("/api/services", { method: "POST", body: { name: "web" } });
    expect(fetch).toHaveBeenCalledWith("/api/services", {
      method: "POST",
      cache: undefined,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "web" }),
    });

    await request("/api/services");
    expect(fetch).toHaveBeenLastCalledWith("/api/services", {
      method: "GET",
      cache: undefined,
      headers: undefined,
      body: undefined,
    });
  });

  it("throws the API's own message on failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Service not found." } }),
    );

    await expect(request("/api/projects/missing")).rejects.toThrow("Service not found.");
  });

  it("throws the fallback when the failure body is not an envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, {}));

    await expect(request("/api/projects")).rejects.toThrow("The request could not be completed.");
  });

  it("throws the fallback when the body is not JSON at all", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);

    await expect(request("/api/projects")).rejects.toThrow("The request could not be completed.");
  });

  it("passes the cache option through to fetch", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: {} }));

    await request("/api/admin/overview", { cache: "no-store" });
    expect(fetch).toHaveBeenCalledWith("/api/admin/overview", {
      method: "GET",
      cache: "no-store",
      headers: undefined,
      body: undefined,
    });
  });
});

describe("transportError", () => {
  it("prefers the Error message and answers a fallback otherwise", () => {
    expect(transportError(new Error("boom"))).toBe("boom");
    expect(transportError("nope")).toBe("The request could not be completed.");
  });
});
