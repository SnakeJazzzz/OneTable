/**
 * lib/ai/model.ts — chat model indirection for the AI chatbot (B5 §9.1, T2).
 *
 * Why this module exists: the route passes `chatModel()` to `streamText`. In
 * production that is the plain gateway model ID string — the AI SDK global
 * provider (Vercel AI Gateway) resolves it using `AI_GATEWAY_API_KEY` from the
 * environment. In tests, mocking a string would mean intercepting HTTP; this
 * one-function indirection lets tests `vi.mock('@/lib/ai/model')` and return a
 * `MockLanguageModelV3` instead — zero network, zero API key.
 *
 * Model choice (closed decision, T1 D-4): `anthropic/claude-haiku-4.5` — the
 * REAL gateway ID (with the dot; verified against the gateway's /v1/models).
 * Fixed constant: no dynamic routing, no per-user model selection. Future
 * escalation path: `anthropic/claude-sonnet-4.6`.
 */

import type { LanguageModel } from 'ai';

export const CHAT_MODEL_ID = 'anthropic/claude-haiku-4.5';

export function chatModel(): LanguageModel {
  return CHAT_MODEL_ID;
}
