import {
  HTTPFetchError,
  messagingApi,
  validateSignature,
  webhook,
} from "@line/bot-sdk";
import {
  ANSWER_BUDGET_MS,
  DEFAULT_REPLY,
  GEMINI_TIMEOUT_MS,
  HANDOFF_REPLY,
} from "@/lib/constants";
import { askGemini } from "@/lib/gemini";
import { isHandoffRequest, isInHandoff, startHandoff } from "@/lib/handoff";
import { getFaqCsv } from "@/lib/sheet";

export const runtime = "nodejs";
export const maxDuration = 10;

type Outcome = "skipped" | "handoff_silent" | "replied" | "reply_failed";

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();

  try {
    const rawBody = await req.text();
    const secret = process.env.LINE_CHANNEL_SECRET;
    const signature = req.headers.get("x-line-signature");
    if (!secret || !signature || !validateSignature(rawBody, secret, signature)) {
      console.warn(JSON.stringify({ tag: "webhook", level: "warning", status: 401 }));
      return new Response("Invalid signature", { status: 401 });
    }

    const { events = [] } = JSON.parse(rawBody) as webhook.CallbackRequest;
    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN as string,
    });
    const deadline = startedAt + ANSWER_BUDGET_MS;

    // Awaited on purpose: Vercel stops the function once the response is sent.
    const outcomes = await Promise.all(
      events.map((event) => handleEvent(client, event, deadline)),
    );

    console.log(
      JSON.stringify({
        tag: "webhook",
        eventCount: events.length,
        outcomes,
        durationMs: Date.now() - startedAt,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        tag: "webhook",
        level: "error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return new Response("OK", { status: 200 });
}

async function handleEvent(
  client: messagingApi.MessagingApiClient,
  event: webhook.Event,
  deadline: number,
): Promise<Outcome> {
  if (event.type !== "message") return "skipped";
  const { replyToken } = event as webhook.MessageEvent;
  if (!replyToken) return "skipped";

  // Staff are talking to this customer, so the bot stays out of the chat.
  const userId = event.source?.userId;
  if (userId && (await isInHandoff(userId))) return "handoff_silent";

  const answer = await buildAnswer(event as webhook.MessageEvent, deadline);

  try {
    await client.replyMessage({
      replyToken,
      messages: [{ type: "text", text: answer }],
    });
    return "replied";
  } catch (err) {
    // Not retried: a replyToken can only be used once.
    console.error(
      JSON.stringify({
        tag: "line_reply",
        level: "error",
        status: err instanceof HTTPFetchError ? err.status : undefined,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return "reply_failed";
  }
}

async function buildAnswer(
  event: webhook.MessageEvent,
  deadline: number,
): Promise<string> {
  const { message } = event;
  if (message.type !== "text") return DEFAULT_REPLY;

  const text = (message as webhook.TextMessageContent).text;
  if (isHandoffRequest(text)) {
    const userId = event.source?.userId;
    if (userId) await startHandoff(userId);
    return HANDOFF_REPLY;
  }

  const faqCsv = await getFaqCsv();
  if (faqCsv === null) return DEFAULT_REPLY;

  const timeoutMs = Math.min(GEMINI_TIMEOUT_MS, deadline - Date.now());
  return askGemini(faqCsv, text, timeoutMs);
}
