import { describe, expect, it, vi } from "vitest";
import { createAgentClient } from "@/lib/agent-client";

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
