import { request } from "@/lib/platform/http";

export type MailProviderId = "resend" | "mailjet";

export type EmailProviderSummary = {
  provider: MailProviderId;
  enabled: boolean;
  priority: number;
  fromEmail: string;
  fromName: string;
  monthlyLimit: number;
  dailyLimit: number;
  usedMonth: number;
  usedDay: number;
  hasKey: boolean;
  hasSecret: boolean;
  keyPreview: string;
  lastError: string | null;
  lastTestedAt: string | null;
  configured: boolean;
};

export type EmailOutboxSummary = {
  id: string;
  toEmail: string;
  subject: string;
  status: "queued" | "sending" | "sent" | "failed";
  provider: MailProviderId | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

export function getEmailProviders(): Promise<EmailProviderSummary[]> {
  return request<EmailProviderSummary[]>("/api/admin/email/providers");
}

export function updateEmailProvider(
  provider: MailProviderId,
  input: {
    enabled: boolean;
    priority: number;
    fromEmail: string;
    fromName: string;
    monthlyLimit: number;
    dailyLimit: number;
    apiKey?: string;
    apiSecret?: string;
  },
): Promise<EmailProviderSummary> {
  return request<EmailProviderSummary>(
    `/api/admin/email/providers/${encodeURIComponent(provider)}`,
    { method: "PUT", body: input },
  );
}

export function sendTestEmail(input: {
  to: string;
  provider: MailProviderId;
}): Promise<{ id: string; provider: MailProviderId; messageId: string }> {
  return request("/api/admin/email/test", { method: "POST", body: input });
}

export function getEmailOutbox(): Promise<EmailOutboxSummary[]> {
  return request<EmailOutboxSummary[]>("/api/admin/email/outbox");
}

export function retryEmail(id: string): Promise<{ id: string }> {
  return request(`/api/admin/email/outbox/${encodeURIComponent(id)}/retry`, { method: "POST" });
}
