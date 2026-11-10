import { apiData, apiError } from "@/lib/platform/api";
import { createAbuseReport } from "@/lib/platform/abuse";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ip =
      request.headers.get("x-real-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
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
