import { describe, expect, it, vi } from "vitest";
import { runJobWithHandler } from "./job-registry";
import type { JobRow } from "../lib/platform/deployments";

function job(type: string, payload: Record<string, unknown> = {}): JobRow {
  return {
    id: "job-1",
    type,
    payload,
    status: "running",
    attempts: 0,
    runAfter: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as JobRow;
}

function io() {
  return {
    completeJob: vi.fn().mockResolvedValue(undefined),
    failJob: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe("runJobWithHandler", () => {
  it("completes the job when the handler succeeds", async () => {
    const io0 = io();
    const handler = vi.fn().mockResolvedValue({ status: "succeeded", subject: "b1" });

    await runJobWithHandler(job("backup"), { backup: handler }, io0);

    expect(handler).toHaveBeenCalledOnce();
    expect(io0.completeJob).toHaveBeenCalledWith("job-1", "succeeded");
    expect(io0.log).toHaveBeenCalledWith("backup b1 succeeded");
    expect(io0.failJob).not.toHaveBeenCalled();
  });

  it("completes as failed when the handler reports a failed operation", async () => {
    const io0 = io();
    const handler = vi.fn().mockResolvedValue({ status: "failed", subject: "b1" });

    await runJobWithHandler(job("backup"), { backup: handler }, io0);

    expect(io0.completeJob).toHaveBeenCalledWith("job-1", "failed");
    expect(io0.failJob).not.toHaveBeenCalled();
  });

  it("fails the job with backoff when the handler throws", async () => {
    const io0 = io();
    const handler = vi.fn().mockRejectedValue(new Error("node unreachable"));

    await runJobWithHandler(job("scan"), { scan: handler }, io0);

    expect(io0.failJob).toHaveBeenCalledWith("job-1", "node unreachable");
    expect(io0.error).toHaveBeenCalledWith("scan job failed: node unreachable", expect.any(Error));
    expect(io0.completeJob).not.toHaveBeenCalled();
  });

  it("completes an unknown Job type as failed instead of retrying forever", async () => {
    const io0 = io();

    await runJobWithHandler(job("mystery"), {}, io0);

    expect(io0.completeJob).toHaveBeenCalledWith("job-1", "failed");
    expect(io0.log).toHaveBeenCalledWith(expect.stringContaining("no handler"));
  });

  it("flattens non-Error throws into the failure message", async () => {
    const io0 = io();
    const handler = vi.fn().mockRejectedValue("boom");

    await runJobWithHandler(job("restore"), { restore: handler }, io0);

    expect(io0.failJob).toHaveBeenCalledWith("job-1", "boom");
  });
});
