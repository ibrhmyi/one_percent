import { createKalshiTickerSocket } from "@/lib/kalshi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function formatSseMessage(data: unknown, event?: string) {
  const prefix = event ? `event: ${event}\n` : "";
  return encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickers = [...new Set(
    (searchParams.get("tickers") ?? "")
      .split(",")
      .map((ticker) => ticker.trim())
      .filter(Boolean)
  )].slice(0, 100);

  if (tickers.length === 0) {
    return new Response("Missing tickers.", { status: 400 });
  }

  let socket: ReturnType<typeof createKalshiTickerSocket> | null = null;
  let heartbeatId: NodeJS.Timeout | null = null;
  let isClosed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (payload: Uint8Array) => {
        if (!isClosed) {
          controller.enqueue(payload);
        }
      };
      const safeClose = () => {
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      };

      safeEnqueue(formatSseMessage({ ready: true }, "ready"));

      heartbeatId = setInterval(() => {
        safeEnqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);

      try {
        socket = createKalshiTickerSocket(tickers, {
          onTicker(payload) {
            safeEnqueue(formatSseMessage(payload));
          },
          onError(error) {
            safeEnqueue(formatSseMessage({ message: error.message }, "error"));
          },
          onClose() {
            if (heartbeatId) {
              clearInterval(heartbeatId);
            }

            safeClose();
          }
        });
      } catch (error) {
        safeEnqueue(
          formatSseMessage(
            {
              message: error instanceof Error ? error.message : "Failed to start Kalshi stream."
            },
            "error"
          )
        );
        safeClose();
      }
    },
    cancel() {
      isClosed = true;

      if (heartbeatId) {
        clearInterval(heartbeatId);
      }

      socket?.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    }
  });
}
