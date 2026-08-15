// Hardening T4 §4.5 (rider R1) — non-object JSON body guard on the six
// route/verb pairs that previously TypeError'd (→ raw 500) on `null`, string
// or number bodies: mappings POST/DELETE/PATCH, credentials PUT, conflicts
// POST, thresholds PUT.
//
// The guard fires BEFORE any DB access (right after req.json()), so these
// tests need only a mocked session — no rows are created or read.
import { describe, it, expect, vi } from 'vitest';

// Mock @/auth BEFORE importing the route handlers — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import {
  POST as mappingsPost,
  DELETE as mappingsDelete,
  PATCH as mappingsPatch,
} from '@/app/api/portales/mappings/route';
import { PUT as credentialsPut } from '@/app/api/portales/credentials/route';
import { POST as conflictsPost } from '@/app/api/portales/conflicts/route';
import { PUT as thresholdsPut } from '@/app/api/parametros/thresholds/route';
import { auth } from '@/auth';

function mockSession() {
  vi.mocked(auth).mockResolvedValueOnce({
    user: { id: 'u-guard', clientId: 'c-guard', email: 'guard@test.local', name: 'Tester' },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as any);
}

function req(method: string, rawJsonBody: string): Request {
  return new Request('http://test/api/body-guard', { method, body: rawJsonBody });
}

// Valid JSON, non-object payloads: `null` and a bare string. Both parse fine
// in req.json() and previously blew up on property access.
const CASES: Array<[label: string, raw: string]> = [
  ['null body', 'null'],
  ['string body', '"soy un string"'],
];

const HANDLERS: Array<
  [name: string, method: string, handler: (r: Request) => Promise<Response>]
> = [
  ['mappings POST', 'POST', mappingsPost],
  ['mappings DELETE', 'DELETE', mappingsDelete],
  ['mappings PATCH', 'PATCH', mappingsPatch],
  ['credentials PUT', 'PUT', credentialsPut],
  ['conflicts POST', 'POST', conflictsPost],
  ['thresholds PUT', 'PUT', thresholdsPut],
];

describe('T4 §4.5 — non-object body guard (6 route/verb pairs)', () => {
  for (const [name, method, handler] of HANDLERS) {
    for (const [label, raw] of CASES) {
      it(`${name}: ${label} → 400 INVALID_BODY`, async () => {
        mockSession();
        const res = await handler(req(method, raw));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe('INVALID_BODY');
      });
    }
  }
});
