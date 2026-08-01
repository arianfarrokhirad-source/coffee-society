import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/**/tests/**/*.test.ts',
      'agents/tests/**/*.test.ts',
      'apps/command-center/tests/**/*.test.ts',
    ],
    environment: 'node',
  },
})
