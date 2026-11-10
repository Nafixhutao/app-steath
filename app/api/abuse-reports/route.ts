import { apiData, apiError } from "@/lib/platform/api";
import { createAbuseReport } from "@/lib/platform/abuse";

// The trusted reverse proxy (Caddy in front of the Control Plane) MUST
// overwrite these headers; otherwise a client can spoof them and evade the
// per-IP limit. Strip anything that could inject or split a header value, and
// fall back to the shared "unknown" bucket so a malformed value still fails
// closed. Spoofing itself is only preventable at the proxy, not here.
function clientIp(headers: Headers): string {
  const candidate = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0];
  const ip = candidate?.trim() ?? "";
  return ip && ip.length <= 45 && !/[\s,"\r\n]/.test(ip) ? ip : "unknown";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ip = clientIp(request.headers);
    return apiData(
      await createAbuseReport({
        targetUrl: body.targetUrl,
        category: body.category,
        description: body.description,
        reporterEmail: body.reporterEmail,
        challengeAnswer: body.challengeAnswer,
        ip,
      }),
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
