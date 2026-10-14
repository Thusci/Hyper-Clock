import { ha } from "@/server/ha";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Live states for the entities the HA console currently shows (?ids=a,b,c). */
export const GET = route({ access: "user" }, ({ request }) => {
  const ids = (new URL(request.url).searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 100);
  const encoder = new TextEncoder();
  let unsubscribe: (() => void | Promise<void>) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  const stop = () => { clearInterval(heartbeat); void unsubscribe?.(); };
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => { try { controller.enqueue(encoder.encode(chunk)); } catch { stop(); } };
      try {
        unsubscribe = await ha.watchSelected(ids, (entities) => send(`event: entities\ndata: ${JSON.stringify(entities)}\n\n`));
      } catch {
        send("event: error\ndata: {}\n\n");
      }
      heartbeat = setInterval(() => send(": heartbeat\n\n"), 20_000);
      request.signal.addEventListener("abort", () => { stop(); try { controller.close(); } catch { /* closed */ } });
    },
    cancel: stop,
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
});
