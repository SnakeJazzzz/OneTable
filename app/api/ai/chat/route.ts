/**
 * POST /api/ai/chat — streaming AI chatbot over the client's sell-out data
 * (B5 §9.1, T2).
 *
 * Body: `{ messages: UIMessage[] }` — the shape `useChat`'s
 * DefaultChatTransport sends (T3). Only `messages` is consumed; any other
 * body field (including injected clientId/userId) is ignored. Tenant identity
 * comes EXCLUSIVELY from the JWT via requireAuth().
 *
 * Flow:
 *   1. requireAuth() → 401 (standard error shape) without a session.
 *   2. Parse JSON body → 400 INVALID_BODY if unparseable or `messages` is
 *      missing / not an array.
 *   3. Strip client-supplied `role: 'system'` messages (fix pass M1): the
 *      server's SYSTEM_PROMPT is the ONLY system authority — the validator
 *      and convertToModelMessages would otherwise forward them to the model
 *      as real system messages. Then the server-side history cap (C1): keep
 *      the last MAX_CHAT_MESSAGES COMPLETE UIMessages, then drop messages
 *      from the start until the window begins with a `role: 'user'` message
 *      (providers can reject history that opens on assistant). Trim, don't
 *      400 — history is client-side by design; the server protects
 *      cost/context without breaking long conversations. An empty post-trim
 *      window (no user message at all) IS a 400 INVALID_MESSAGES: there is
 *      nothing valid to send to the model.
 *   4. safeValidateUIMessages → 400 INVALID_MESSAGES on malformed messages.
 *      No validator details reach the client; the server log carries the
 *      error name only, never the payload.
 *   5. streamText with the 7 read-only tools (buildTools) bound to the
 *      session's { clientId, userId } and a lazy threshold-cuts loader.
 *      Tool loop capped at stepCountIs(5). Incomplete tool calls in the
 *      history are ignored (fix pass M2) so an aborted tool step can't
 *      poison the conversation.
 *   6. UI message stream response; stream errors surface as the literal
 *      'CHAT_ERROR' — never the underlying message/stack.
 *
 * Stateless by design: no DB writes, no conversation persistence (history
 * lives client-side). Rate limiting: deferred (hardening backlog).
 *
 * Runtime: Node (first route in the repo to pin it) — Prisma does not run on
 * the edge runtime, and the tool executes hit Neon through PrismaClient.
 */

import {
  convertToModelMessages,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { getThresholdCuts } from '@/lib/thresholds';
import { chatModel } from '@/lib/ai/model';
import { buildTools } from '@/core/ai/tools';

export const runtime = 'nodejs';

// C1 cap: last N complete UIMessages. Server-side guard so a long client
// history can't blow up cost/context; the window is then aligned to start on
// a user message (see trimMessages).
const MAX_CHAT_MESSAGES = 30;

// Stable module-level const — NOTHING volatile interpolated (no date, no
// clientId): byte-identical across requests so gateway prompt caching works
// (§9.1.2). The "current period" is resolved by the tools, not the prompt.
// Prompt is in English (technical standard); the assistant answers in Spanish.
const SYSTEM_PROMPT = `You are OneTable's data assistant for a retail supplier in Mexico. You answer questions about the current client's sell-out (sales) and inventory data across retail chains, using ONLY the provided tools.

Language and formatting:
- Always answer in neutral Spanish, regardless of the language of the question.
- All monetary amounts are Mexican pesos. Format them as MXN (e.g. "$12,345.60 MXN").

Data discipline:
- Only report figures that come from tool results. Never invent, estimate, or extrapolate numbers.
- If none of the tools can answer the question, say so plainly instead of guessing.
- Prefer aggregated tools with a small limit. Do not fetch raw rows (getOneTableRows) when an aggregate answers the question.

Periods:
- If the user does not specify a month, call tools WITHOUT periodYear/periodMonth: they resolve the most recent period with data and echo the resolved periodYear/periodMonth in their result. Always state which month and year your answer refers to.

Interpreting tool results:
- A result of {"error":"NO_DATA"} means the client has no data loaded yet. Say exactly that — no sales/inventory data has been uploaded — and suggest uploading portal files. It is not a technical failure.
- getSalesTrend expresses "no data" differently: it returns rows as an empty array ([]) when there is no data in the requested window. An empty trend is NOT an error and does not mean the client has no data at all — report it as "no data in that window".
- A result of {"error":"TOOL_EXECUTION_ERROR"} is a transient technical failure. Offer to retry; do not speculate about the cause.
- When a result includes totalRows and totalRows is greater than the number of rows returned, the list was truncated: tell the user you are showing N of M (in Spanish, e.g. "mostrando 20 de 3,188").`;

// Defensive role accessor — strip/trim run pre-validation on unknown input.
function roleOf(m: unknown): unknown {
  return typeof m === 'object' && m !== null
    ? (m as { role?: unknown }).role
    : undefined;
}

// Strip + C1 trim, in this order:
//   (0) STRIP client-supplied `role: 'system'` messages (fix pass M1) — the
//       server's SYSTEM_PROMPT is the ONLY system authority; without this an
//       authenticated client could append instructions with system-level
//       authority after it. Strip runs FIRST so discarded system messages
//       never consume the MAX_CHAT_MESSAGES quota;
//   (a) keep the last MAX_CHAT_MESSAGES complete UIMessages;
//   (b) drop messages from the start of the window until it begins with role
//       'user'.
// Operates pre-validation (hence `unknown[]` + defensive role access) and on
// WHOLE messages only — in the ai@6 UIMessage format tool calls/results live
// inside assistant message parts, so slicing whole messages can never split a
// call/result pair.
function trimMessages(messages: unknown[]): unknown[] {
  const nonSystem = messages.filter((m) => roleOf(m) !== 'system');
  const window = nonSystem.slice(-MAX_CHAT_MESSAGES);
  const firstUserIdx = window.findIndex((m) => roleOf(m) === 'user');
  return firstUserIdx === -1 ? [] : window.slice(firstUserIdx);
}

export async function POST(req: Request): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { userId, clientId } = sessionOrError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  const messages =
    typeof body === 'object' && body !== null
      ? (body as { messages?: unknown }).messages
      : undefined;
  if (!Array.isArray(messages)) {
    return errorResponse(
      'INVALID_BODY',
      'Request body must include a "messages" array',
      400,
    );
  }

  const trimmed = trimMessages(messages);
  if (trimmed.length === 0) {
    // Empty request, or a window with no user message at all — nothing valid
    // to send to the model.
    return errorResponse(
      'INVALID_MESSAGES',
      'Conversation must include a user message',
      400,
    );
  }

  const validated = await safeValidateUIMessages<UIMessage>({
    messages: trimmed,
  });
  if (!validated.success) {
    // Error NAME only in the server log — never the message/payload (it can
    // embed user content). The client gets a generic 400.
    console.error(`[ai-chat] message validation failed (${validated.error.name})`);
    return errorResponse('INVALID_MESSAGES', 'Messages are not valid', 400);
  }

  const result = streamText({
    model: chatModel(),
    system: SYSTEM_PROMPT,
    // ignoreIncompleteToolCalls (fix pass M2): an aborted tool step (T3's
    // stop()/tab close mid-step) leaves a tool part in 'input-available' in
    // the client-side history; without the flag that converts to an orphan
    // tool-call, streamText throws MissingToolResultsError in-stream, and —
    // since the history is client-side and never repaired — EVERY later
    // request re-sends it: conversation permanently stuck on CHAT_ERROR.
    messages: await convertToModelMessages(validated.data, {
      ignoreIncompleteToolCalls: true,
    }),
    // clientId/userId from the SESSION — never from the body. loadCuts is the
    // raw lib/thresholds loader; core's ToolRuntime memoizes it per request.
    tools: buildTools({
      db,
      clientId,
      userId,
      loadCuts: () => getThresholdCuts(db, clientId),
    }),
    stopWhen: stepCountIs(5),
  });

  // onError ALWAYS returns the generic literal — never the underlying
  // message/stack into the stream (same principle as the tool layer).
  return result.toUIMessageStreamResponse({ onError: () => 'CHAT_ERROR' });
}
