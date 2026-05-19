// NextAuth v5 — re-export the route handlers from the root auth.ts config.
// `handlers` is `{ GET, POST }` — both verbs serve all /api/auth/* subpaths
// (signin, signout, callback, csrf, session, providers).
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
