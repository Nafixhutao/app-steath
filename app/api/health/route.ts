import { checkPlatformHealth } from "@/lib/platform/health";

export async function GET() {
  const health = await checkPlatformHealth();

  return Response.json(health.body, { status: health.statusCode });
}
