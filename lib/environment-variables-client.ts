import { request } from "@/lib/platform/http";

export type EnvironmentVariableSummary = {
  id: string;
  serviceId: string;
  key: string;
  /** The masked placeholder; the full value only comes from an explicit reveal. */
  maskedValue: string;
  createdAt: string;
  updatedAt: string;
};

export type EnvironmentVariableList = {
  variables: EnvironmentVariableSummary[];
  needsRedeploy: boolean;
};

export type RevealedEnvironmentVariable = {
  id: string;
  key: string;
  value: string;
};

function serviceVariablesPath(serviceId: string): string {
  return `/api/services/${encodeURIComponent(serviceId)}/environment-variables`;
}

function variablePath(serviceId: string, variableId: string): string {
  return `${serviceVariablesPath(serviceId)}/${encodeURIComponent(variableId)}`;
}

export function listEnvironmentVariables(serviceId: string): Promise<EnvironmentVariableList> {
  return request<EnvironmentVariableList>(serviceVariablesPath(serviceId));
}

export type SaveEnvironmentVariableInput = {
  key: string;
  value?: string;
};

export function createEnvironmentVariable(
  serviceId: string,
  input: SaveEnvironmentVariableInput,
): Promise<EnvironmentVariableSummary> {
  return request<EnvironmentVariableSummary>(serviceVariablesPath(serviceId), {
    method: "POST",
    body: input,
  });
}

export type UpdateEnvironmentVariableInput = {
  key?: string;
  value?: string;
};

export function updateEnvironmentVariable(
  serviceId: string,
  variableId: string,
  input: UpdateEnvironmentVariableInput,
): Promise<EnvironmentVariableSummary> {
  return request<EnvironmentVariableSummary>(variablePath(serviceId, variableId), {
    method: "PATCH",
    body: input,
  });
}

export function deleteEnvironmentVariable(
  serviceId: string,
  variableId: string,
): Promise<{ id: string }> {
  return request<{ id: string }>(variablePath(serviceId, variableId), { method: "DELETE" });
}

/**
 * Asks for the full value of one variable. This is the explicit request the
 * masking rule is built around, so it is a POST and the response is not cached.
 */
export function revealEnvironmentVariable(
  serviceId: string,
  variableId: string,
): Promise<RevealedEnvironmentVariable> {
  return request<RevealedEnvironmentVariable>(`${variablePath(serviceId, variableId)}/reveal`, {
    method: "POST",
  });
}
