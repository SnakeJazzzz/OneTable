import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Importing the module for its side effect is the thing under test.
import '@/lib/zod-jitless';

describe('lib/zod-jitless', () => {
  it('sets jitless: true on zod global config (T6 Tanda A)', () => {
    // NOTE on global state: z.config mutates zod's globalConfig, but the
    // suite runs with fileParallelism: false + isolate (default true)
    // (vitest.config.ts), so each test file gets a fresh module registry —
    // the mutation stays confined to THIS file, not the whole process.
    // Harmless anyway: jitless only switches $ZodObject off its
    // eval-compiled fast path onto the regular parse path — identical
    // results, no behavioral change.
    expect(z.core.globalConfig.jitless).toBe(true);
  });
});
