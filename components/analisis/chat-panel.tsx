'use client';

// Chat panel over the client's data (B5 T3, spec §3.3.2/§9.1.3).
//
// useChat + DefaultChatTransport against /api/ai/chat (the T2 route). The
// conversation history lives in memory only — navigating away discards it
// (by design, no persistence). Tool activity renders as a generic,
// non-technical indicator: never the tool name, never the raw payload.
// Errors (useChat `error`, which also captures the in-band CHAT_ERROR
// literal) render a generic es-MX message + retry; nothing technical
// reaches the user.
//
// Accessibility: the aria-live region announces STATUS transitions
// (thinking / done / error) — never the streaming text container, which
// would announce every delta.

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, type UIMessage } from 'ai';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const ERROR_COPY =
  'Ocurrió un error al procesar tu pregunta. Vuelve a intentarlo.';

// Generic tool-in-progress copy (external-filter minor, 2026-07-16): the UI
// NEVER shows the tool name or its payload.
const TOOL_IN_PROGRESS_COPY = 'Consultando tus datos…';

function MessageParts({ message }: { message: UIMessage }) {
  return (
    <>
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <p key={i} className="whitespace-pre-wrap text-sm text-foreground">
              {part.text}
            </p>
          );
        }
        if (isToolUIPart(part)) {
          // In-flight tool step → generic indicator. Finished steps render
          // nothing: the assistant's text carries the answer, and the raw
          // tool output must never reach the UI.
          if (part.state === 'input-streaming' || part.state === 'input-available') {
            return (
              <p key={i} className="text-xs italic text-muted-foreground">
                {TOOL_IN_PROGRESS_COPY}
              </p>
            );
          }
          return null;
        }
        // step-start / reasoning / file / source / data parts: not rendered.
        return null;
      })}
    </>
  );
}

export function ChatPanel() {
  // Transport config is static; keep one instance for the component's life.
  const [transport] = useState(
    () => new DefaultChatTransport({ api: '/api/ai/chat' }),
  );
  const { messages, sendMessage, status, stop, error, clearError, regenerate } =
    useChat({ transport });

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isBusy = status === 'submitted' || status === 'streaming';

  // Keep the newest message in view while the conversation grows/streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    if (error) clearError();
    void sendMessage({ text });
    setInput('');
    // Focus back on the input after send (a11y — brief §2.2).
    inputRef.current?.focus();
  }

  function handleRetry() {
    clearError();
    void regenerate();
    inputRef.current?.focus();
  }

  return (
    <Card className="flex h-96 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4"
        aria-label="Conversación con el asistente"
      >
        {messages.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            Pregúntale a tus datos. Por ejemplo: &ldquo;¿Cuánto vendí en
            Soriana este mes?&rdquo; o &ldquo;¿Qué productos están en
            riesgo de quiebre?&rdquo;
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'max-w-[85%] rounded-lg px-3 py-2',
              m.role === 'user'
                ? 'ml-auto bg-primary/15'
                : 'mr-auto bg-muted',
            )}
          >
            <MessageParts message={m} />
          </div>
        ))}
        {status === 'submitted' && (
          <p className="text-xs italic text-muted-foreground">Pensando…</p>
        )}
        {error && (
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
            <p className="text-sm text-foreground">{ERROR_COPY}</p>
            <Button type="button" onClick={handleRetry} className="h-8 px-3">
              Reintentar
            </Button>
          </div>
        )}
      </div>

      {/* Status announcer for screen readers: state / completion only, NEVER
          the streaming text container (it would announce every delta). */}
      <p aria-live="polite" role="status" className="sr-only">
        {isBusy
          ? 'El asistente está respondiendo.'
          : error
            ? 'Ocurrió un error en la conversación.'
            : messages.some((m) => m.role === 'assistant')
              ? 'Respuesta completada.'
              : ''}
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Escribe tu pregunta sobre tus datos
        </label>
        <Input
          id="chat-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu pregunta…"
          autoComplete="off"
        />
        {isBusy ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => stop()}
            className="gap-2"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            Detener
          </Button>
        ) : (
          <Button type="submit" disabled={input.trim().length === 0} className="gap-2">
            <Send className="h-4 w-4" aria-hidden="true" />
            Enviar
          </Button>
        )}
      </form>
    </Card>
  );
}
