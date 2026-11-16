export type CustomDomainStatus = "pending" | "active" | "failed";
export type CustomDomainCertificateStatus = "pending" | "issued" | "failed";

export type CustomDomainInstructions = {
  txt: { name: string; value: string };
  a: { name: string; value: string | null };
  cname: { name: string; value: string };
};

export type CustomDomainSummary = {
  id: string;
  serviceId: string;
  hostname: string;
  status: CustomDomainStatus;
  certificateStatus: CustomDomainCertificateStatus;
  verifiedAt: string | null;
  lastError: string | null;
  instructions: CustomDomainInstructions;
  createdAt: string;
  updatedAt: string;
};

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = (await response.json().catch(() => ({}))) as { data?: T } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as T;
}

function domainPath(serviceId: string): string {
  return `/api/services/${encodeURIComponent(serviceId)}/custom-domain`;
}

export function getServiceCustomDomain(serviceId: string): Promise<CustomDomainSummary | null> {
  return request<CustomDomainSummary | null>(domainPath(serviceId));
}

export function addServiceCustomDomain(
  serviceId: string,
  hostname: string,
): Promise<CustomDomainSummary> {
  return request<CustomDomainSummary>(domainPath(serviceId), {
    method: "POST",
    body: { hostname },
  });
}

export function verifyServiceCustomDomain(serviceId: string): Promise<CustomDomainSummary> {
  return request<CustomDomainSummary>(`${domainPath(serviceId)}/verify`, { method: "POST" });
}

export function deleteServiceCustomDomain(
  serviceId: string,
): Promise<{ id: string; serviceId: string; hostname: string }> {
  return request<{ id: string; serviceId: string; hostname: string }>(domainPath(serviceId), {
    method: "DELETE",
  });
}
