import { corsHeaders } from "@/server/http";
import { kioskHub } from "@/server/kiosk/hub";

export const dynamic = "force-dynamic";

/** The watch face's live feed. All logic lives in KioskHub; this only adapts it to SSE. */
export function GET(request: Request) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = kioskHub.subscribe((event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          unsubscribe();
        }
      });
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders(), "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
