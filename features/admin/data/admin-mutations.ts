"use client";

import { useState } from "react";
import { adminSend } from "@/lib/admin/queries";
import type {
  AdminAccount,
  CreateAdminIncidentRequest,
  UpdateAdminErrorGroupStatusRequest,
  UpdateAdminOAuthProviderRequest,
} from "@/lib/admin/api-schema";

/**
 * Admin mutations, ported from stealth-forge's `api/mutations/admin`. Each
 * hook exposes TanStack-compatible flags over plain fetch; the callers only
 * read `isPending`, `variables`, and `mutate/mutateAsync`.
 */

export interface PlanMutationInput {
  accountID: string;
  plan: string;
}

export function useUpdateAdminAccountPlan() {
  const [pending, setPending] = useState(false);
  const [variables, setVariables] = useState<PlanMutationInput | undefined>();
  const [error, setError] = useState<Error | null>(null);

  const mutate = (input: PlanMutationInput) => {
    setPending(true);
    setVariables(input);
    setError(null);
    adminSend<{ account: AdminAccount }>(
      `/api/admin/accounts/${input.accountID}/plan`,
      "PUT",
      { plan: input.plan },
    )
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause : new Error("The request failed."),
        ),
      )
      .finally(() => setPending(false));
  };

  return { mutate, isPending: pending, variables, error };
}

export function useCreateAdminIncident() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = async (input: CreateAdminIncidentRequest) => {
    setPending(true);
    setError(null);
    try {
      return await adminSend<{ incident: unknown }>(
        "/api/admin/incidents",
        "POST",
        input,
      );
    } catch (cause: unknown) {
      const failure =
        cause instanceof Error ? cause : new Error("The request failed.");
      setError(failure);
      throw failure;
    } finally {
      setPending(false);
    }
  };

  return { mutateAsync, isPending: pending, error };
}

export function useUpdateAdminErrorStatus() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = async (input: {
    fingerprint: string;
    status: UpdateAdminErrorGroupStatusRequest["status"];
  }) => {
    setPending(true);
    setError(null);
    try {
      return await adminSend<{ group: unknown }>(
        `/api/admin/telemetry/errors/${encodeURIComponent(input.fingerprint)}/status`,
        "PUT",
        { status: input.status },
      );
    } catch (cause: unknown) {
      const failure =
        cause instanceof Error ? cause : new Error("The request failed.");
      setError(failure);
      throw failure;
    } finally {
      setPending(false);
    }
  };

  return { mutateAsync, isPending: pending, error };
}

/** Provider names the instance supports for external sign-in. */
export type OAuthProviderName = "github" | "google";

/** Save one provider's client credentials. The secret is write-only. */
export function useUpdateAdminOAuthProvider() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = (
    input: {
      provider: OAuthProviderName;
      body: UpdateAdminOAuthProviderRequest;
    },
    options?: { onSuccess?: () => void },
  ) => {
    setPending(true);
    setError(null);
    adminSend(
      `/api/admin/oauth-providers/${input.provider}`,
      "PUT",
      input.body,
    )
      .then(() => options?.onSuccess?.())
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause : new Error("The request failed."),
        ),
      )
      .finally(() => setPending(false));
  };

  return { mutate, isPending: pending, error };
}

/** Remove one provider's stored credentials. */
export function useDeleteAdminOAuthProvider() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = (
    provider: OAuthProviderName,
    options?: { onSuccess?: () => void },
  ) => {
    setPending(true);
    setError(null);
    adminSend(`/api/admin/oauth-providers/${provider}`, "DELETE", {})
      .then(() => options?.onSuccess?.())
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause : new Error("The request failed."),
        ),
      )
      .finally(() => setPending(false));
  };

  return { mutate, isPending: pending, error };
}
