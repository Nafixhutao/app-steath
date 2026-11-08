import { createAgentClient, streamServiceLogs } from "@/lib/agent-client";
import { apiError } from "@/lib/platform/api";
import { nodeConfig } from "@/lib/platform/nodes";
import { getServiceRuntime } from "@/lib/platform/runtime";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string }> };

const DEFAULT_TAIL = 200;
const MAX_TAIL = 1000;

/**
 * Streams a Service's runtime log to the dashboard. The Node Agent follows the
 * container, so new lines arrive as the application writes them. Members may read
 * logs, which the spec allows even though they cannot change the Service.
 */
export async function GET(request: Request, context: RouteContext) {
  let actor: Awaited<ReturnType<typeof requireOrganizationRole>>;
  let serviceId: string;

  try {
    actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    ({ serviceId } = await context.params);

    // A Service with no container has nothing to stream; answer 409 so the
    // dashboard can explain it instead of waiting on an empty stream.
    const state = await getServiceRuntime(actor.organizationId, serviceId);
    if (state.status === "absent") {
      return Response.json(
        {
          error: {
            code: "service_not_running",
            message: "This Service has no container yet. Deploy it first.",
          },
        },
        { status: 409 },
      );
    }
  } catch (error) {
    return apiError(error);
  }

  const tail = clampTail(new URL(request.url).searchParams.get("tail"));
  const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamServiceLogs(client, serviceId, tail, (event) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }, request.signal);
      } catch (error) {
        // The reader is usually gone by now (the user navigated away), so the
        // error is only logged rather than thrown into a closed stream.
        if (!request.signal.aborted) {
          console.error(`stream runtime logs for ${serviceId}`, error);
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}

function clampTail(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_TAIL;
  }

  return Math.min(parsed, MAX_TAIL);
}
