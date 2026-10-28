import { pool } from "../db";
import { authenticate, AppError, type User } from "../auth";
import { executorPosition } from "./delivery";
export async function orderSnapshot(u: User, id: string) {
  const row = (
    await pool.query(
      `SELECT o.id,o.state,o.status,o.provider_id,o.service_type,o.dispute_status,s.status AS fulfillment,s.recipient_id,
 (SELECT max(id) FROM service_messages WHERE request_id=o.id) AS service_message_revision,
 (SELECT max(id) FROM messages WHERE shipment_id=o.shipment_id) AS delivery_message_revision
 FROM orders o LEFT JOIN shipments s ON s.id=o.shipment_id WHERE o.id=$1 AND (o.customer_id=$2 OR o.provider_id=$2 OR s.recipient_id=$2)`,
      [id, u.id],
    )
  ).rows[0];
  if (!row) throw new AppError(403, "Нет доступа к заказу");
  return {
    ...row,
    executorPosition: row.provider_id
      ? await executorPosition(
          pool,
          row.provider_id,
          row.service_type,
          ![
            "created",
            "searching",
            "offered",
            "completed",
            "cancelled",
          ].includes(row.state),
        )
      : null,
  };
}
// Snapshot SSE: reconnect always sends current state. No claim of replaying a lost delta log.
export async function orderStream(
  id: string,
  token: string,
  signal: AbortSignal,
) {
  const initial = await orderSnapshot(await authenticate(token), id);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval>,
    deadline: ReturnType<typeof setTimeout>;
  let closed = false,
    busy = false,
    previous = "";
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearTimeout(deadline);
        signal.removeEventListener("abort", close);
        controller.close();
      };
      const emit = (snapshot: unknown) => {
        const data = JSON.stringify(snapshot);
        if (closed || data === previous) return;
        previous = data;
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      emit(initial);
      timer = setInterval(async () => {
        if (closed || busy) return;
        busy = true;
        try {
          emit(await orderSnapshot(await authenticate(token), id));
          if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
        } finally {
          busy = false;
        }
      }, 2000);
      deadline = setTimeout(close, 55000);
      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) close();
    },
    cancel() {
      closed = true;
      clearInterval(timer);
      clearTimeout(deadline);
      signal.removeEventListener("abort", close);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
