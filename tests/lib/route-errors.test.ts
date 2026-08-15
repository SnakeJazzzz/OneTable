// Hardening T4 — lib/route-errors.ts unit tests (brief §6).
//
// Pure unit level: no DB, no real routes. The wrapper's contract:
//   - passthrough of the handler's own Response (success AND returned 4xx);
//   - uncaught throw → 500 { error: { code: 'INTERNAL' } } + ONE structured
//     JSON console.error line (source/route/name/method[/code/message/stack]);
//   - omitMessage drops message AND stack (V8 stacks embed the message).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// lib/route-errors → lib/auth-helpers → @/auth → next-auth: mocked for the
// same reason every tests/api/* file mocks it (unresolvable under vitest).
vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { withRouteErrors, logRouteError } from '@/lib/route-errors';

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

function lastLogLine(): Record<string, unknown> {
  expect(errSpy).toHaveBeenCalledTimes(1);
  const arg = errSpy.mock.calls[0][0];
  expect(typeof arg).toBe('string');
  return JSON.parse(arg as string) as Record<string, unknown>;
}

describe('withRouteErrors', () => {
  it('passthrough: the handler Response comes back untouched, nothing logged', async () => {
    const original = Response.json({ ok: true }, { status: 200 });
    const wrapped = withRouteErrors('test/route', async () => original);

    const res = await wrapped();

    expect(res).toBe(original);
    expect(await res.json()).toEqual({ ok: true });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('a RETURNED error Response (e.g. the 401 from requireAuth) is not logged nor transformed', async () => {
    const the401 = new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
    const wrapped = withRouteErrors('test/route', async (_req: Request) => the401);

    const res = await wrapped(new Request('http://test/x', { method: 'GET' }));

    expect(res).toBe(the401);
    expect(res.status).toBe(401);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('an uncaught throw → 500 with the standard INTERNAL shape', async () => {
    const wrapped = withRouteErrors('test/route', async () => {
      throw new Error('boom');
    });

    const res = await wrapped();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Error interno del servidor' },
    });
  });

  it('the log line is ONE parseable JSON with source/route/name/message/stack', async () => {
    const wrapped = withRouteErrors('portales/counts', async () => {
      throw new Error('boom');
    });

    await wrapped();

    const line = lastLogLine();
    expect(line.source).toBe('api');
    expect(line.route).toBe('portales/counts');
    expect(line.name).toBe('Error');
    expect(line.message).toBe('boom');
    expect(typeof line.stack).toBe('string');
  });

  it('method is duck-typed from args[0] when it is a Request', async () => {
    const wrapped = withRouteErrors('test/route', async (_req: Request) => {
      throw new Error('boom');
    });

    await wrapped(new Request('http://test/x', { method: 'DELETE' }));

    expect(lastLogLine().method).toBe('DELETE');
  });

  it('method is absent when the first arg is not a Request (e.g. handlers invoked bare in tests)', async () => {
    const wrapped = withRouteErrors('test/route', async () => {
      throw new Error('boom');
    });

    await wrapped();

    expect('method' in lastLogLine()).toBe(false);
  });

  it('a string `code` on the error (Prisma P-codes) lands in the line', async () => {
    const prismaish = Object.assign(new Error('fk violated'), { code: 'P2003' });
    const wrapped = withRouteErrors('test/route', async () => {
      throw prismaish;
    });

    await wrapped();

    expect(lastLogLine().code).toBe('P2003');
  });

  it("re-throws Next's DYNAMIC_SERVER_USAGE sentinel untouched (build-time static optimization), no log", async () => {
    const sentinel = Object.assign(new Error('Dynamic server usage: headers'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    });
    const wrapped = withRouteErrors('test/route', async () => {
      throw sentinel;
    });

    await expect(wrapped()).rejects.toBe(sentinel);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('a non-Error throw is logged with typeof as name and String() as message', async () => {
    const wrapped = withRouteErrors('test/route', async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'plain string failure';
    });

    const res = await wrapped();

    expect(res.status).toBe(500);
    const line = lastLogLine();
    expect(line.name).toBe('string');
    expect(line.message).toBe('plain string failure');
    expect('stack' in line).toBe(false);
  });
});

describe('logRouteError (direct calls from inside handlers)', () => {
  it('carries clientId and method when the caller passes them', () => {
    logRouteError('parametros/skus', new Error('boom'), {
      method: 'POST',
      clientId: 'client-123',
    });

    const line = lastLogLine();
    expect(line.route).toBe('parametros/skus');
    expect(line.method).toBe('POST');
    expect(line.clientId).toBe('client-123');
    expect(line.message).toBe('boom');
  });

  it('omitMessage: true drops message AND stack (V8 stacks embed the message), keeps name/code', () => {
    const err = Object.assign(new Error('raw user content here'), { code: 'X1' });
    logRouteError('ai/chat', err, { omitMessage: true });

    const line = lastLogLine();
    expect(line.name).toBe('Error');
    expect(line.code).toBe('X1');
    expect('message' in line).toBe(false);
    expect('stack' in line).toBe(false);
  });
});
