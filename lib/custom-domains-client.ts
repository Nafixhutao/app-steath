import { request } from "@/lib/platform/http";

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
