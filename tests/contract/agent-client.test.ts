import { describe, expect, it, vi } from "vitest";
import { createAgentClient, streamBuildLogs } from "@/lib/agent-client";

describe("Node Agent client contract", () => {
  it("calls the health endpoint and parses the response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const client = createAgentClient(
      "http://agent.test",
      "secret",
      fetchImpl as typeof globalThis.fetch,
    );
    const { data, response } = await client.GET("/v1/health");

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("Build log stream", () => {
  /** A fake agent that answers one NDJSON body. */
  function ndjsonClient(body: string) {
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        }),
    );

    return createAgentClient("http://agent.test", "secret", fetchImpl as typeof globalThis.fetch);
  }

  it("drops a malformed line and keeps reading the rest", async () => {
    const client = ndjsonClient('not-json\n{"sequence":2,"message":"second"}\n');
    const seen: string[] = [];

    await streamBuildLogs(client, "build-1", 0, (event) => {
      seen.push(event.message);
    });

    expect(seen).toEqual(["second"]);
  });

  it("surfaces a consumer failure instead of swallowing the remaining lines", async () => {
    const client = ndjsonClient(
      '{"sequence":1,"message":"first"}\n{"sequence":2,"message":"second"}\n',
    );
    const seen: string[] = [];

    await expect(
      streamBuildLogs(client, "build-1", 0, (event) => {
        seen.push(event.message);
        throw new Error("log write failed");
      }),
    ).rejects.toThrow("log write failed");

    // The stream stops at the failure rather than pretending the line was junk.
    expect(seen).toEqual(["first"]);
  });
});
