import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

const BASE_URL = "http://localhost:3000";
const PASSWORD = "password-12345";
const RUN_ID = Math.random().toString(36).slice(2, 8);
const AGENT_TOKEN = "test-agent-token";

function uniqueName(base: string): string {
  return `${base}${RUN_ID}`;
}

type Auth = (typeof import("@/lib/auth"))["auth"];

let auth: Auth;

type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string }>;
  services: Map<string, "running" | "stopped">;
  routes: Map<string, string>;
  reset(): void;
};

async function startFakeAgent(): Promise<FakeAgent> {
  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    services: new Map<string, "running" | "stopped">(),
    routes: new Map<string, string>(),
    reset() {
      agent.requests = [];
      agent.services = new Map<string, "running" | "stopped">();
      agent.routes = new Map<string, string>();
    },
  };

  agent.server = createServer((request, response) => {
    void handleAgentRequest(agent, request, response);
  });

  await new Promise<void>((resolve) => {
    agent.server.listen(0, "127.0.0.1", resolve);
  });

  const address = agent.server.address() as AddressInfo;
  agent.baseUrl = `http://127.0.0.1:${address.port}`;

  return agent;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleAgentRequest(
  agent: FakeAgent,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://agent.test");
  await readBody(request);

  if (request.headers.authorization !== `Bearer ${AGENT_TOKEN}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  agent.requests.push({ method: request.method ?? "GET", path: url.pathname });

  const hostnameMatch = url.pathname.match(
    /^\/v1\/services\/([^/]+)\/hostnames\/([^/]+)$/,
  );
  if (hostnameMatch) {
    const serviceId = decodeURIComponent(hostnameMatch[1]);
    const hostname = decodeURIComponent(hostnameMatch[2]);
    const status = agent.services.get(serviceId);

    if (request.method === "PUT") {
      if (!status) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "service_not_running" } }));
        return;
      }
      if (status !== "running") {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "service_not_running" } }));
        return;
      }
      agent.routes.set(hostname, serviceId);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ serviceId, hostname, routed: true }));
      return;
    }

    if (request.method === "DELETE") {
      agent.routes.delete(hostname);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ serviceId, hostname, routed: false }));
      return;
    }
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}

let agent: FakeAgent;

beforeAll(async () => {
  process.env.ENV_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  await prepareTestDatabase();
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
  process.env.AGENT_TOKEN = AGENT_TOKEN;

  agent = await startFakeAgent();
  process.env.AGENT_BASE_URL = agent.baseUrl;
  process.env.AGENT_NAME = "test-node";

  ({ auth } = await import("@/lib/auth"));
});

afterAll(async () => {
  if (agent) {
    await new Promise<void>((resolve) => agent.server.close(() => resolve()));
  }
});

type SignUpResult = { cookie: string; userId: string; organizationId: string };

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
  const body = (await response.json()) as { user: { id: string } };
  const session = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
  const sessionBody = (await session.json()) as {
    session: { activeOrganizationId: string };
  };

  return {
    cookie,
    userId: body.user.id,
    organizationId: sessionBody.session.activeOrganizationId,
  };
}

async function addMember(
  ownerCookie: string,
  organizationId: string,
  role: "admin" | "member",
): Promise<SignUpResult> {
  const email = uniqueName(`cd${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
  const inviteResponse = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    }),
  );
  expect(inviteResponse.status).toBe(200);
  const invitation = (await inviteResponse.json()) as { id: string };

  const member = await signUp(email, email.split("@")[0].replace(/[^a-z0-9]/gi, ""));
  const accepted = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/accept-invitation`, {
      method: "POST",
      headers: { cookie: member.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ invitationId: invitation.id }),
    }),
  );
  expect(accepted.status).toBe(200);

  const session = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie: member.cookie, origin: BASE_URL },
    }),
  );
  const sessionBody = (await session.json()) as {
    session: { activeOrganizationId: string };
  };
  expect(sessionBody.session.activeOrganizationId).toBe(organizationId);

  return member;
}

type ServiceBody = { id: string; name: string; status: string; projectId: string; platformHostname: string };

async function createProject(cookie: string, name: string): Promise<{ id: string; name: string }> {
  const { POST } = await import("@/app/api/projects/route");
  const response = await POST(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string; name: string } }).data;
}

async function createService(
  cookie: string,
  projectId: string,
  name: string,
): Promise<ServiceBody> {
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
  return ((await response.json()) as { data: ServiceBody }).data;
}

async function customDomainRequest(
  cookie: string,
  serviceId: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const { GET, POST, DELETE } = await import("@/app/api/services/[serviceId]/custom-domain/route");
  const request = new Request(`${BASE_URL}/api/services/${serviceId}/custom-domain`, {
    method: init.method ?? "GET",
    headers: {
      cookie,
      origin: BASE_URL,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const context = { params: Promise.resolve({ serviceId }) };

  if (init.method === "POST") return POST(request, context);
  if (init.method === "DELETE") return DELETE(request, context);
  return GET(request, context);
}

async function verifyRequest(cookie: string, serviceId: string): Promise<Response> {
  const { POST } = await import("@/app/api/services/[serviceId]/custom-domain/verify/route");
  return POST(
    new Request(`${BASE_URL}/api/services/${serviceId}/custom-domain/verify`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    }),
    { params: Promise.resolve({ serviceId }) },
  );
}

async function askRequest(token: string, hostname: string): Promise<Response> {
  const { GET } = await import("@/app/api/internal/caddy/ask/route");
  return GET(
    new Request(
      `${BASE_URL}/api/internal/caddy/ask?token=${encodeURIComponent(token)}&domain=${encodeURIComponent(hostname)}`,
    ),
  );
}

type CustomDomainBody = {
  id: string;
  serviceId: string;
  hostname: string;
  status: "pending" | "active" | "failed";
  certificateStatus: "pending" | "issued" | "failed";
  verifiedAt: string | null;
  lastError: string | null;
  instructions: {
    txt: { name: string; value: string };
    a: { name: string; value: string | null };
    cname: { name: string; value: string };
  };
};

type FailureBody = { error: { code: string; message: string } };

async function queryRows<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } finally {
    await pool.end();
  }
}

describe("Custom Domain", () => {
  it("adds one Custom Domain per Service and rejects a second", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cdowner") + "@example.test",
      uniqueName("cdowner"),
    );
    const project = await createProject(owner.cookie, "Custom Domain");
    const service = await createService(owner.cookie, project.id, "Web App");

    const response = await customDomainRequest(owner.cookie, service.id, {
      method: "POST",
      body: { hostname: `  App.${uniqueName("Example")}.COM. ` },
    });
    expect(response.status).toBe(200);
    const domain = ((await response.json()) as { data: CustomDomainBody }).data;

    expect(domain.hostname).toBe(`app.${uniqueName("example")}.com`);
    expect(domain.status).toBe("pending");
    expect(domain.certificateStatus).toBe("pending");
    expect(domain.instructions.txt.name).toBe(`_stealth-verify.${domain.hostname}`);
    expect(domain.instructions.txt.value).toMatch(/^[0-9a-f]{32}$/);
    expect(domain.instructions.cname.name).toBe(domain.hostname);

    const duplicate = await customDomainRequest(owner.cookie, service.id, {
      method: "POST",
      body: { hostname: `other.${uniqueName("example")}.com` },
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as FailureBody).error.code).toBe("custom_domain_exists");

    const read = await customDomainRequest(owner.cookie, service.id);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { data: CustomDomainBody }).data.hostname).toBe(
      domain.hostname,
    );

    const events = await queryRows<{ action: string }>(
      'SELECT "action" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
      [owner.organizationId, "custom_domain.%"],
    );
    expect(events.map((event) => event.action)).toEqual(["custom_domain.created"]);
  });

  it("rejects a hostname another Service already uses", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cdconflict") + "@example.test",
      uniqueName("cdconflict"),
    );
    const project = await createProject(owner.cookie, "Custom Domain Conflict");
    const first = await createService(owner.cookie, project.id, "First App");
    const second = await createService(owner.cookie, project.id, "Second App");
    const hostname = `shared.${uniqueName("example")}.com`;

    const created = await customDomainRequest(owner.cookie, first.id, {
      method: "POST",
      body: { hostname },
    });
    expect(created.status).toBe(200);

    const conflict = await customDomainRequest(owner.cookie, second.id, {
      method: "POST",
      body: { hostname },
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as FailureBody).error.code).toBe("hostname_taken");

    // A Platform Subdomain is just as reserved as another Custom Domain.
    const platform = await customDomainRequest(owner.cookie, second.id, {
      method: "POST",
      body: { hostname: first.platformHostname },
    });
    expect(platform.status).toBe(409);
    expect(((await platform.json()) as FailureBody).error.code).toBe("hostname_taken");
  });

  it("lets members read the domain but never change it", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cdroles") + "@example.test",
      uniqueName("cdroles"),
    );
    const project = await createProject(owner.cookie, "Custom Domain Roles");
    const service = await createService(owner.cookie, project.id, "Role App");
    const member = await addMember(owner.cookie, owner.organizationId, "member");

    expect((await customDomainRequest(member.cookie, service.id)).status).toBe(200);

    const create = await customDomainRequest(member.cookie, service.id, {
      method: "POST",
      body: { hostname: `member.${uniqueName("example")}.com` },
    });
    expect(create.status).toBe(403);

    expect((await verifyRequest(member.cookie, service.id)).status).toBe(403);
    expect((await customDomainRequest(member.cookie, service.id, { method: "DELETE" })).status).toBe(
      403,
    );

    const ownerCreate = await customDomainRequest(owner.cookie, service.id, {
      method: "POST",
      body: { hostname: `owner.${uniqueName("example")}.com` },
    });
    expect(ownerCreate.status).toBe(200);

    const memberRead = await customDomainRequest(member.cookie, service.id);
    const memberDomain = ((await memberRead.json()) as { data: CustomDomainBody }).data;
    expect(memberDomain.hostname).toContain("owner.");
  });

  it("verifies the TXT record, routes the hostname, and allows its certificate", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cdverify") + "@example.test",
      uniqueName("cdverify"),
    );
    const project = await createProject(owner.cookie, "Custom Domain Verify");
    const service = await createService(owner.cookie, project.id, "Verify App");
    const hostname = `verify.${uniqueName("example")}.com`;
    agent.services.set(service.id, "running");

    const added = await customDomainRequest(owner.cookie, service.id, {
      method: "POST",
      body: { hostname },
    });
    expect(added.status).toBe(200);
    const domain = ((await added.json()) as { data: CustomDomainBody }).data;

    const { setDnsResolver } = await import("@/lib/platform/custom-domains");
    setDnsResolver({
      resolveTxt: async () => [[domain.instructions.txt.value]],
      lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    });

    try {
      const verified = await verifyRequest(owner.cookie, service.id);
      expect(verified.status).toBe(200);
      const body = ((await verified.json()) as { data: CustomDomainBody }).data;
      expect(body.status).toBe("active");
      expect(body.certificateStatus).toBe("issued");
      expect(body.verifiedAt).not.toBeNull();
      expect(body.lastError).toBeNull();

      expect(agent.routes.get(hostname)).toBe(service.id);
      expect((await askRequest(AGENT_TOKEN, hostname)).status).toBe(200);
      expect((await askRequest(AGENT_TOKEN, service.platformHostname)).status).toBe(200);

      const events = await queryRows<{ action: string }>(
        'SELECT "action" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
        [owner.organizationId, "custom_domain.%"],
      );
      expect(events.map((event) => event.action)).toEqual([
        "custom_domain.created",
        "custom_domain.verified",
      ]);
    } finally {
      setDnsResolver(null);
    }
  });

  it("records a failed verification and leaves the Platform Subdomain serving", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cdfail") + "@example.test",
      uniqueName("cdfail"),
    );
    const project = await createProject(owner.cookie, "Custom Domain Failure");
    const service = await createService(owner.cookie, project.id, "Failure App");
    const hostname = `fail-${RUN_ID}.invalid`;
    agent.services.set(service.id, "running");

    const added = await customDomainRequest(owner.cookie, service.id, {
      method: "POST",
      body: { hostname },
    });
    expect(added.status).toBe(200);
    const domain = ((await added.json()) as { data: CustomDomainBody }).data;

    const { setDnsResolver } = await import("@/lib/platform/custom-domains");
    setDnsResolver({
      resolveTxt: async () => {
        throw new Error("NXDOMAIN");
      },
      lookup: async () => {
        throw new Error("NXDOMAIN");
      },
    });

    try {
      const verified = await verifyRequest(owner.cookie, service.id);
      expect(verified.status).toBe(200);
      const body = ((await verified.json()) as { data: CustomDomainBody }).data;
      expect(body.status).toBe("failed");
      expect(body.certificateStatus).toBe("failed");
      expect(body.lastError).toContain(domain.instructions.txt.name);

      // The Platform Subdomain is untouched and still allowed.
      const { getService } = await import("@/lib/platform/services");
      const after = await getService(owner.organizationId, service.id);
      expect(after.platformHostname).toBe(service.platformHostname);
      expect((await askRequest(AGENT_TOKEN, service.platformHostname)).status).toBe(200);

      // No Custom Domain route was programmed and nothing was deleted.
      expect(agent.routes.has(hostname)).toBe(false);
      expect(agent.requests.some((request) => request.method === "DELETE")).toBe(false);
      expect((await askRequest(AGENT_TOKEN, hostname)).status).toBe(403);

      const events = await queryRows<{ action: string }>(
        'SELECT "action" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
        [owner.organizationId, "custom_domain.%"],
      );
      expect(events.map((event) => event.action)).toEqual([
        "custom_domain.created",
        "custom_domain.verification_failed",
      ]);
    } finally {
      setDnsResolver(null);
    }
  });

  it("deletes the domain, its route, and its certificate status", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cddelete") + "@example.test",
      uniqueName("cddelete"),
    );
    const project = await createProject(owner.cookie, "Custom Domain Delete");
    const service = await createService(owner.cookie, project.id, "Delete App");
    const hostname = `delete.${uniqueName("example")}.com`;
    agent.services.set(service.id, "running");

    const added = await customDomainRequest(owner.cookie, service.id, {
      method: "POST",
      body: { hostname },
    });
    const domain = ((await added.json()) as { data: CustomDomainBody }).data;

    const { setDnsResolver } = await import("@/lib/platform/custom-domains");
    setDnsResolver({
      resolveTxt: async () => [[domain.instructions.txt.value]],
      lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    });

    try {
      expect((await verifyRequest(owner.cookie, service.id)).status).toBe(200);
    } finally {
      setDnsResolver(null);
    }

    expect((await askRequest(AGENT_TOKEN, hostname)).status).toBe(200);

    const removed = await customDomainRequest(owner.cookie, service.id, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(agent.routes.has(hostname)).toBe(false);
    expect((await askRequest(AGENT_TOKEN, hostname)).status).toBe(403);

    const read = await customDomainRequest(owner.cookie, service.id);
    expect(((await read.json()) as { data: CustomDomainBody | null }).data).toBeNull();

    const events = await queryRows<{ action: string }>(
      'SELECT "action" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
      [owner.organizationId, "custom_domain.%"],
    );
    expect(events.map((event) => event.action)).toEqual([
      "custom_domain.created",
      "custom_domain.verified",
      "custom_domain.deleted",
    ]);
  });

  it("only allows registered hostnames through the certificate ask endpoint", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cdask") + "@example.test",
      uniqueName("cdask"),
    );
    const project = await createProject(owner.cookie, "Custom Domain Ask");
    const service = await createService(owner.cookie, project.id, "Ask App");
    const hostname = `ask.${uniqueName("example")}.com`;

    expect((await askRequest("wrong-token", service.platformHostname)).status).toBe(401);
    expect((await askRequest(AGENT_TOKEN, service.platformHostname)).status).toBe(200);
    expect((await askRequest(AGENT_TOKEN, `unknown.${uniqueName("example")}.com`)).status).toBe(403);

    const added = await customDomainRequest(owner.cookie, service.id, {
      method: "POST",
      body: { hostname },
    });
    expect(added.status).toBe(200);
    // A pending domain has not proven control, so it gets no certificate.
    expect((await askRequest(AGENT_TOKEN, hostname)).status).toBe(403);
  });

  it("never exposes another tenant's Service", async () => {
    agent.reset();
    const owner = await signUp(
      uniqueName("cdtenant") + "@example.test",
      uniqueName("cdtenant"),
    );
    const other = await signUp(
      uniqueName("cdother") + "@example.test",
      uniqueName("cdother"),
    );
    const project = await createProject(owner.cookie, "Custom Domain Tenant");
    const service = await createService(owner.cookie, project.id, "Tenant App");

    expect((await customDomainRequest(other.cookie, service.id)).status).toBe(404);

    const create = await customDomainRequest(other.cookie, service.id, {
      method: "POST",
      body: { hostname: `other-tenant.${uniqueName("example")}.com` },
    });
    expect(create.status).toBe(404);
  });
});
