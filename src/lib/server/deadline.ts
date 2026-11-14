import { AsyncLocalStorage } from "node:async_hooks";
import { HttpError } from "./http";

// Carries the turn's cancellation into nested extraction, scans and SDK calls.
export const turnSignal = new AsyncLocalStorage<AbortSignal>();
export function requestSignal(timeoutMs: number): AbortSignal {
  const turn = turnSignal.getStore();
  return turn ? AbortSignal.any([turn, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}
export function checkDeadline() {
  if (turnSignal.getStore()?.aborted) throw new HttpError(408, "turn_deadline", "This turn reached its time limit. Please try a smaller request.");
}
