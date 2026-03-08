import { appConfig } from "@/lib/config";
import { constants, createSign } from "node:crypto";
import { createRequire } from "node:module";
import type { RawData } from "ws";

process.env.WS_NO_BUFFER_UTIL = "1";
process.env.WS_NO_UTF_8_VALIDATE = "1";

const require = createRequire(import.meta.url);
const wsModule = require("ws") as typeof import("ws");
const WebSocket = (wsModule.default ?? wsModule) as typeof import("ws").default;

type KalshiStreamHandlers = {
  onTicker: (payload: {
    marketTicker: string;
    yesBid: number | null;
    yesAsk: number | null;
    lastPrice: number | null;
    volume: number | null;
    openInterest: number | null;
    raw: unknown;
  }) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
};

function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\n/g, "\n");
}

function buildKalshiHeaders() {
  const hasKeyId = appConfig.kalshiApiKeyId.trim().length > 0;
  const hasPrivateKey = appConfig.kalshiPrivateKey.trim().length > 0;

  if (!hasKeyId && !hasPrivateKey) {
    return undefined;
  }

  if (!hasKeyId || !hasPrivateKey) {
    throw new Error("Kalshi websocket auth is incomplete. Set both KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY.");
  }

  const url = new URL(appConfig.kalshiWsUrl);
  const timestamp = Date.now().toString();
  const message = `${timestamp}GET${url.pathname}`;
  const signer = createSign("RSA-SHA256");

  signer.update(message);
  signer.end();

  return {
    "KALSHI-ACCESS-KEY": appConfig.kalshiApiKeyId,
    "KALSHI-ACCESS-SIGNATURE": signer
      .sign({
        key: normalizePrivateKey(appConfig.kalshiPrivateKey),
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      })
      .toString("base64"),
    "KALSHI-ACCESS-TIMESTAMP": timestamp
  };
}

function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createKalshiTickerSocket(
  marketTickers: string[],
  handlers: KalshiStreamHandlers
) {
  const headers = buildKalshiHeaders();
  const socket = new WebSocket(appConfig.kalshiWsUrl, headers ? { headers } : undefined);
  let messageId = 1;

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        id: messageId,
        cmd: "subscribe",
        params: {
          channels: ["ticker"],
          market_tickers: marketTickers
        }
      })
    );
    messageId += 1;
  });

  socket.on("message", (data: RawData) => {
    try {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;

      if (parsed.type !== "ticker" || typeof parsed.msg !== "object" || parsed.msg === null) {
        return;
      }

      const message = parsed.msg as Record<string, unknown>;

      if (typeof message.market_ticker !== "string") {
        return;
      }

      handlers.onTicker({
        marketTicker: message.market_ticker,
        yesBid: toNullableNumber(message.yes_bid),
        yesAsk: toNullableNumber(message.yes_ask),
        lastPrice: toNullableNumber(message.price ?? message.last_price),
        volume: toNullableNumber(message.volume),
        openInterest: toNullableNumber(message.open_interest),
        raw: parsed
      });
    } catch (error) {
      handlers.onError?.(
        error instanceof Error ? error : new Error("Failed to parse Kalshi websocket frame.")
      );
    }
  });

  socket.on("error", (error: Error) => {
    handlers.onError?.(error instanceof Error ? error : new Error("Kalshi websocket failed."));
  });

  socket.on("close", () => {
    handlers.onClose?.();
  });

  return socket;
}
