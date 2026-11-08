import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { authenticateNodeToken, recordHeartbeat, type NodeSummary } from "@/lib/platform/nodes";

type HeartbeatBody = {
  capacity?: NodeSummary["capacity"];
};

/**
 * Heartbeat from the Node Agent. This route is authenticated by the shared
 * agent token rather than a user session, because the agent is not a User.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  try {
    if (!token) {
      throw new ApiError(401, "unauthenticated", "Missing Node Agent token.");
    }

    const node = await authenticateNodeToken(token);

    let body: HeartbeatBody = {};
    try {
      body = (await request.json()) as HeartbeatBody;
    } catch {
      // A heartbeat without a body is still useful: the timestamp alone proves
      // the agent is alive.
    }

    const summary = await recordHeartbeat({
      name: node.name,
      capacity: body.capacity ?? {},
    });

    return apiData(summary);
  } catch (error) {
    return apiError(error);
  }
}
