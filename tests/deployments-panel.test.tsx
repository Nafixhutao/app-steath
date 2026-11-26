// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentsPanel } from "@/app/dashboard/services/[serviceId]/deployments-panel";
import type { DeploymentSummary } from "@/lib/services-client";

function deployment(index: number): DeploymentSummary {
  const started = new Date(Date.UTC(2026, 0, index + 1, 10, 0, 0)).toISOString();
  return {
    id: `deployment-${index}`,
    serviceId: "service-1",
    status: "running",
    commitSha: `e4373e${index.toString(16)}`,
    imageRef: null,
    errorMessage: null,
    startedAt: started,
    finishedAt: new Date(Date.parse(started) + 15_000).toISOString(),
    createdAt: started,
  };
}

const deployments = Array.from({ length: 12 }, (_, index) => deployment(index));

vi.mock("@/lib/services-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services-client")>();
  return {
    ...actual,
    listDeployments: vi.fn(async () => deployments),
    listNodes: vi.fn(async () => [
      { id: "node-1", name: "node-1", status: "healthy", lastSeenAt: null, capacity: {} },
    ]),
    getBuildLog: vi.fn(async (deploymentId: string) => ({
      deployment: deployments.find((item) => item.id === deploymentId) ?? deployments[0],
      lines: ["step 1: build", "step 2: push"],
    })),
  };
});

afterEach(cleanup);

describe("DeploymentsPanel", () => {
  it("shows one compact row per Deployment and pages the rest", async () => {
    render(<DeploymentsPanel serviceId="service-1" canDeploy canManage />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(10));

    fireEvent.click(screen.getByRole("button", { name: /show older deployments \(2\)/i }));

    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /show older deployments/i })).toBeNull();
  });

  it("keeps the build log folded until its row is asked for", async () => {
    render(<DeploymentsPanel serviceId="service-1" canDeploy canManage />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(10));
    expect(screen.queryByText("step 1: build")).toBeNull();

    const firstLog = screen.getAllByRole("button", { name: /view build log/i })[0];
    fireEvent.click(firstLog);

    await waitFor(() => expect(screen.getByText(/step 1: build/)).toBeTruthy());
    expect(firstLog.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(firstLog);
    expect(screen.queryByText(/step 1: build/)).toBeNull();
  });
});
