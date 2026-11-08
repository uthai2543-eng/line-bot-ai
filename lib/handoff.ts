import { Redis } from "@upstash/redis";
import {
  HANDOFF_DURATION_SECONDS,
  HANDOFF_KEYWORD,
  REDIS_TIMEOUT_MS,
} from "./constants";

function getRedis(): Redis {
  return Redis.fromEnv({
    cache: "no-store",
    retry: false,
    signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
}

const handoffKey = (userId: string) => `handoff:${userId}`;

export function isHandoffRequest(text: string): boolean {
  return text.replace(/\s+/g, "") === HANDOFF_KEYWORD;
}

/** On a Redis failure this returns false: a customer must never go unanswered. */
export async function isInHandoff(userId: string): Promise<boolean> {
  try {
    return (await getRedis().exists(handoffKey(userId))) > 0;
  } catch (err) {
    logFailure("check", err);
    return false;
  }
}

export async function startHandoff(userId: string): Promise<void> {
  try {
    await getRedis().set(handoffKey(userId), "1", {
      ex: HANDOFF_DURATION_SECONDS,
    });
  } catch (err) {
    logFailure("start", err);
  }
}

function logFailure(operation: string, err: unknown): void {
  console.error(
    JSON.stringify({
      tag: "handoff",
      level: "error",
      operation,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}
