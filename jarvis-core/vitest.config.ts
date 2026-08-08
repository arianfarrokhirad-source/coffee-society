import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The command-centre app imports through the `@/` alias declared in its
  // tsconfig. Without the same alias here, any test that touches a server
  // action fails to resolve at import time — which is why the action wiring
  // had no test coverage until now.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/command-center', import.meta.url)),
      // `server-only` throws on import by design. That guard protects the
      // client bundle and has no meaning in a test process, where it would
      // simply make server modules untestable.
      'server-only': fileURLToPath(new URL('./tools/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/**/tests/**/*.test.ts',
      'agents/tests/**/*.test.ts',
      'apps/command-center/tests/**/*.test.ts',
    ],
    environment: 'node',
  },
})
