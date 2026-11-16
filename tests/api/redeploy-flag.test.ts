import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

const BASE_URL = "http://localhost:3000";
const PASSWORD = "password-12345";
const RUN_ID = Math.random().toString(36).slice(2, 8);

function uniqueName(base: string): string {
  return `${base}${RUN_ID}`;
}

type Auth = (typeof import("@/lib/auth"))["auth"];

let auth: Auth;

beforeAll(async () => {
  await prepareTestDatabase();
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";

  ({ auth } = await import("@/lib/auth"));
});

type SignUpResult = { cookie: string; organizationId: string };

async function signUp(email: string, username: string): Promise<SignUpResult> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email, password: PASSWORD, name: username, username }),
    }),
  );

  expect(response.status).toBe(200);

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const session = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
  const body = (await session.json()) as {
    session: { activeOrganizationId: string };
  };

  return { cookie, organizationId: body.session.activeOrganizationId };
}

async function createProject(cookie: string, name: string): Promise<{ id: string }> {
  const { POST } = await import("@/app/api/projects/route");
  const response = await POST(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );

  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data;
}

async function createService(
  cookie: string,
  projectId: string,
  name: string,
): Promise<{ id: string }> {
  const { POST } = await import("@/app/api/projects/[projectId]/services/route");
  const response = await POST(
    new Request(`${BASE_URL}/api/projects/${projectId}/services`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        repoUrl: "https://github.com/example/web-app",
        branch: "main",
      }),
    }),
    { params: Promise.resolve({ projectId }) },
  );

  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data;
}

/**
 * Appends a Deployment that is already serving traffic. `finishedAt` is when a
 * Deployment became running, so it is the timestamp that orders the history.
 */
async function insertRunningDeployment(input: {
  serviceId: string;
  envRevision: number;
  createdAt: string;
  finishedAt: string;
}): Promise<void> {
  const { pool } = await import("@/lib/platform/db");
  await pool.query(
    `INSERT INTO "deployment" ("id", "serviceId", "status", "envRevision", "createdAt", "finishedAt")
     VALUES (gen_random_uuid()::text, $1, 'running', $2, $3, $4)`,
    [input.serviceId, input.envRevision, input.createdAt, input.finishedAt],
  );
}

type PanelFlags = {
  service: boolean;
  volume: boolean;
  database: boolean;
  variables: boolean;
};

/**
 * Reads the flag the way each dashboard panel reads it: the Service page, the
 * Volume panel, the Database panel, and the Environment panel.
 */
async function readRedeployFlags(input: {
  organizationId: string;
  projectId: string;
  serviceId: string;
}): Promise<PanelFlags> {
  const [{ getService }, { getServiceVolume }, { getProjectDatabase }, { listEnvironmentVariables }] =
    await Promise.all([
      import("@/lib/platform/services"),
      import("@/lib/platform/volumes"),
      import("@/lib/platform/databases"),
      import("@/lib/platform/environment-variables"),
    ]);

  const [service, volume, database, variables] = await Promise.all([
    getService(input.organizationId, input.serviceId),
    getServiceVolume(input.organizationId, input.serviceId),
    getProjectDatabase({
      organizationId: input.organizationId,
      projectId: input.projectId,
      includeConnectionString: false,
    }),
    listEnvironmentVariables(input.organizationId, input.serviceId),
  ]);

  return {
    service: service.needsRedeploy,
    volume: volume.needsRedeploy,
    database: database.needsRedeploy,
    variables: variables.needsRedeploy,
  };
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe("needsRedeploy", () => {
  it("answers the same flag on every panel as the revision moves", async () => {
    const owner = await signUp(uniqueName("flagagree") + "@example.test", uniqueName("flagagree"));
    const project = await createProject(owner.cookie, "Flag Agreement");
    const service = await createService(owner.cookie, project.id, "Flag App");
    const { bumpRevision } = await import("@/lib/platform/revisions");

    const offline: PanelFlags = {
      service: false,
      volume: false,
      database: false,
      variables: false,
    };
    const stale: PanelFlags = {
      service: true,
      volume: true,
      database: true,
      variables: true,
    };

    expect(await readRedeployFlags({ ...owner, projectId: project.id, serviceId: service.id })).toEqual(
      offline,
    );

    // Nothing is live yet, so a revision bump alone is not a pending redeploy.
    await bumpRevision(service.id);
    expect(await readRedeployFlags({ ...owner, projectId: project.id, serviceId: service.id })).toEqual(
      offline,
    );

    // A Deployment that recorded the current revision is up to date.
    await insertRunningDeployment({
      serviceId: service.id,
      envRevision: 1,
      createdAt: minutesAgo(10),
      finishedAt: minutesAgo(10),
    });
    expect(await readRedeployFlags({ ...owner, projectId: project.id, serviceId: service.id })).toEqual(
      offline,
    );

    // A later change makes every panel agree that a redeploy is pending.
    await bumpRevision(service.id);
    expect(await readRedeployFlags({ ...owner, projectId: project.id, serviceId: service.id })).toEqual(
      stale,
    );

    // Deploying the new revision clears the flag everywhere at once.
    await insertRunningDeployment({
      serviceId: service.id,
      envRevision: 2,
      createdAt: minutesAgo(1),
      finishedAt: minutesAgo(1),
    });
    expect(await readRedeployFlags({ ...owner, projectId: project.id, serviceId: service.id })).toEqual(
      offline,
    );
  });

  it("reads the revision of the live container, not the highest one in history", async () => {
    const owner = await signUp(uniqueName("flaglive") + "@example.test", uniqueName("flaglive"));
    const project = await createProject(owner.cookie, "Flag Live");
    const service = await createService(owner.cookie, project.id, "Live App");
    const { bumpRevision } = await import("@/lib/platform/revisions");

    await bumpRevision(service.id);

    // History: a Deployment that recorded the current revision but was replaced.
    await insertRunningDeployment({
      serviceId: service.id,
      envRevision: 1,
      createdAt: minutesAgo(1),
      finishedAt: minutesAgo(10),
    });

    // Live: the container that was started last is running the old revision.
    await insertRunningDeployment({
      serviceId: service.id,
      envRevision: 0,
      createdAt: minutesAgo(10),
      finishedAt: minutesAgo(1),
    });

    // Comparing against the highest revision in history would hide this; the
    // newest `finishedAt` is the container the Service points at.
    expect(await readRedeployFlags({ ...owner, projectId: project.id, serviceId: service.id })).toEqual({
      service: true,
      volume: true,
      database: true,
      variables: true,
    });
  });

  it("keeps the shared 404 for another Organization's Service and Project", async () => {
    const owner = await signUp(uniqueName("flagown") + "@example.test", uniqueName("flagown"));
    const outsider = await signUp(
      uniqueName("flagout") + "@example.test",
      uniqueName("flagout"),
    );
    const project = await createProject(owner.cookie, "Flag Owned");
    const service = await createService(owner.cookie, project.id, "Owned App");

    const [{ getService }, { getServiceVolume }, { getProjectDatabase }, { listEnvironmentVariables }, { getServiceRuntime }] =
      await Promise.all([
        import("@/lib/platform/services"),
        import("@/lib/platform/volumes"),
        import("@/lib/platform/databases"),
        import("@/lib/platform/environment-variables"),
        import("@/lib/platform/runtime"),
      ]);

    await expect(getService(outsider.organizationId, service.id)).rejects.toMatchObject({
      status: 404,
      code: "service_not_found",
    });
    await expect(getServiceVolume(outsider.organizationId, service.id)).rejects.toMatchObject({
      status: 404,
      code: "service_not_found",
    });
    await expect(
      listEnvironmentVariables(outsider.organizationId, service.id),
    ).rejects.toMatchObject({ status: 404, code: "service_not_found" });
    await expect(getServiceRuntime(outsider.organizationId, service.id)).rejects.toMatchObject({
      status: 404,
      code: "service_not_found",
    });
    await expect(
      getProjectDatabase({
        organizationId: outsider.organizationId,
        projectId: project.id,
        includeConnectionString: false,
      }),
    ).rejects.toMatchObject({ status: 404, code: "project_not_found" });
  });
});
