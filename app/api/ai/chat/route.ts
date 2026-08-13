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
 *   4. Size caps over the trimmed window (T3 hardening): >8000 chars summed
 *      across the text parts of any `role: 'user'` message (exactly 8000
 *      passes), or >64KB of serialized JSON for ANY message (the client-side
 *      history means an authenticated client can forge giant "tool results")
 *      → 400 MESSAGE_TOO_LONG.
 *   5. safeValidateUIMessages → 400 INVALID_MESSAGES on malformed messages.
 *      No validator details reach the client; the server log carries the
 *      error name only, never the payload.
 *   6. Per-client daily quota (T3 hardening): the limit is read from
 *      Client.chatDailyLimit (default 40), then consumeRateLimit charges one
 *      unit against scope 'chat:client' keyed by the SESSION clientId over a
 *      fixed 24h window → 429 RATE_LIMITED when exhausted. The consume runs
 *      immediately before streamText, so `count ≤ limit` ≡ "requests that
 *      actually reached the model" — a 400/401 never burns quota. FAIL-OPEN
 *      (T2 §5.2): a limiter DB error degrades to "no limit", never to a
 *      broken chat.
 *   7. streamText with the 7 read-only tools (buildTools) bound to the
 *      session's { clientId, userId } and a lazy threshold-cuts loader.
 *      Tool loop capped at stepCountIs(5), output capped at
 *      maxOutputTokens: 2000. Incomplete tool calls in the history are
 *      ignored (fix pass M2) so an aborted tool step can't poison the
 *      conversation.
 *   8. UI message stream response; stream errors surface as the literal
 *      'CHAT_ERROR' — never the underlying message/stack.
 *
 * Stateless by design: no DB writes, no conversation persistence (history
 * lives client-side). The only DB reads are the chatDailyLimit lookup and
 * the rate-limit counter (plus whatever the tools query per request).
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
import { consumeRateLimit } from '@/lib/rate-limit';
import { getThresholdCuts } from '@/lib/thresholds';
import { chatModel } from '@/lib/ai/model';
import { buildTools } from '@/core/ai/tools';

export const runtime = 'nodejs';

// C1 cap: last N complete UIMessages. Server-side guard so a long client
// history can't blow up cost/context; the window is then aligned to start on
// a user message (see trimMessages).
const MAX_CHAT_MESSAGES = 30;

// Size caps (T3): both run pre-validation over the TRIMMED window and both
// reject with 400 MESSAGE_TOO_LONG.
//   - MAX_USER_MESSAGE_CHARS caps the summed text parts of each user message
//     (the real vector: typed/pasted text). Exactly 8000 chars passes.
//   - MAX_MESSAGE_JSON_BYTES is the coarse cap on the serialized JSON of ANY
//     message: the history is client-side, so an authenticated client can
//     forge oversized "tool result" parts inside assistant messages. 64KB
//     clears every legitimate result of the 7 tools (small row limits by
//     design) with room to spare.
const MAX_USER_MESSAGE_CHARS = 8000;
const MAX_MESSAGE_JSON_BYTES = 64 * 1024;

// Daily chat quota (T3): fixed window aligned to the epoch boundary —
// windowStart = floor(now / 86_400_000) * 86_400_000 (lib/rate-limit.ts
// semantics). The "day" resets at midnight UTC = 18:00 in CDMX (UTC-6 fixed;
// Mexico has no DST since 2022). NOT rolling-24h, NOT local midnight. The
// limit itself is per-client (Client.chatDailyLimit, default 40).
const CHAT_RATE_SCOPE = 'chat:client';
const CHAT_RATE_WINDOW_MS = 86_400_000;

// Stable module-level const — NOTHING volatile interpolated (no date, no
// clientId): byte-identical across requests so the gateway's automatic prompt
// caching can reuse the prefix (§9.1.2, mechanism at the streamText call
// below). The "current period" is resolved by the tools, not the prompt.
// Prompt is in English (technical standard); the assistant answers in Spanish.
const SYSTEM_PROMPT = `You are OneTable's data assistant for a retail supplier in Mexico. You answer questions about the current client's sell-out (sales) and inventory data across retail chains, using ONLY the provided tools.

Language and formatting:
- Always answer in neutral Spanish, regardless of the language of the question.
- All monetary amounts are Mexican pesos. Format them as MXN (e.g. "$12,345.60 MXN").

Data discipline:
- Only report figures that come from tool results. Never invent, estimate, or extrapolate numbers.
- If none of the tools can answer the question, say so plainly instead of guessing.
- Prefer aggregated tools with a small limit. Do not fetch raw rows (getOneTableRows) when an aggregate answers the question.
- Quantitative recommendations or plans (reorder quantities, targets, forecasts): give a figure ONLY if every number is derived arithmetically from tool results of THIS conversation, and show the operation (e.g. "1,200 sold − 800 in stock = 400 to reorder"). If you cannot derive it, say explicitly that the data gives no basis for a specific figure, stop there, and name the data that would be needed.
- Derived arithmetic must be exact: compute carefully, round percentages to one decimal or present them as approximate (e.g. "≈35%"). Never present an imprecise figure as precise.
- Report every figure at the exact level the tool returned it: never attribute a chain-level aggregate to a product, nor a product-level figure to a chain.
- Naming: Soriana, Chedraui, HEB, etc. are "cadenas" or "retailers". NEVER call them "cuentas de la plataforma" or reinterpret what they are.

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

// Summed length of the text parts of a message (defensive: runs
// pre-validation on unknown input, like roleOf). Non-text/malformed parts
// contribute 0 — they are bounded by the coarse JSON cap instead.
function userTextLength(m: unknown): number {
  const parts =
    typeof m === 'object' && m !== null ? (m as { parts?: unknown }).parts : undefined;
  if (!Array.isArray(parts)) return 0;
  let total = 0;
  for (const part of parts) {
    if (
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      total += ((part as { text: string }).text).length;
    }
  }
  return total;
}

// Both T3 size caps over the trimmed window. True → reject 400
// MESSAGE_TOO_LONG. Boundary: exactly MAX_USER_MESSAGE_CHARS passes.
function exceedsSizeCaps(trimmed: unknown[]): boolean {
  for (const m of trimmed) {
    if (roleOf(m) === 'user' && userTextLength(m) > MAX_USER_MESSAGE_CHARS) {
      return true;
    }
    if (Buffer.byteLength(JSON.stringify(m), 'utf8') > MAX_MESSAGE_JSON_BYTES) {
      return true;
    }
  }
  return false;
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

  if (exceedsSizeCaps(trimmed)) {
    return errorResponse(
      'MESSAGE_TOO_LONG',
      'A message exceeds the allowed size',
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

  // Per-client daily limit, read from the Client row (select minimal). If the
  // read throws (DB down), it propagates to Next's default 500 — accepted
  // behavior, no new handling here (T3 brief §4.2/E4; T4's route-error sweep
  // subsumes it).
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { chatDailyLimit: true },
  });
  if (client === null) {
    // Client deleted while the session is still alive (E4): treat as an auth
    // problem, never invoke the model, never burn quota.
    return errorResponse('UNAUTHORIZED', 'Sign in required', 401);
  }

  // Consume immediately before streamText: count ≤ limit ≡ requests that
  // actually reached the model (a 400/401 above never burns quota).
  // FAIL-OPEN on limiter DB errors (T2 §5.2) — degrades to "no limit".
  const verdict = await consumeRateLimit({
    scope: CHAT_RATE_SCOPE,
    key: clientId,
    limit: client.chatDailyLimit,
    windowMs: CHAT_RATE_WINDOW_MS,
  });
  if (!verdict.allowed) {
    return errorResponse(
      'RATE_LIMITED',
      'Alcanzaste tu límite diario de preguntas al asistente',
      429,
    );
  }

  const result = streamText({
    model: chatModel(),
    system: SYSTEM_PROMPT,
    // Prompt caching (T3 §4.6, post-gate fix): the GATEWAY places the cache
    // breakpoints itself — providers with explicit caching (Anthropic) need
    // `gateway.caching: 'auto'` at the call level (docs:
    // vercel.com/docs/ai-gateway/models-and-providers/automatic-caching).
    // Verified empirically against the real gateway (scratch, 2026-08-12):
    // request 1 cache write > 0, request 2 cache read > 0. The previous
    // mechanism (SystemModelMessage with message-level anthropic.cacheControl)
    // was REMOVED, not kept alongside: production observability (2026-08-12,
    // deployment 3ff2438) showed cache read/write = 0 on every request with
    // it, so it cannot be trusted end-to-end through the gateway — keeping a
    // second, unverifiable mechanism with a comment claiming it works is
    // honesty debt. SYSTEM_PROMPT stays byte-stable (see its declaration):
    // any volatile interpolation would break the cached prefix.
    providerOptions: { gateway: { caching: 'auto' } },
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
    // Output cap (T3): bounds the cost of a single response. 2000 tokens is
    // ample for a data answer; the tool loop is already capped at 5 steps.
    maxOutputTokens: 2000,
  });

  // onError ALWAYS returns the generic literal — never the underlying
  // message/stack into the stream (same principle as the tool layer).
  return result.toUIMessageStreamResponse({ onError: () => 'CHAT_ERROR' });
}
