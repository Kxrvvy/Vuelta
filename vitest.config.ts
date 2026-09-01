import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // No jsdom, deliberately. Spec §5's test for whether the layer boundary is
    // real is that core/ runs with no DOM. If a test here ever needs a DOM,
    // something has leaked out of the skin layer and into core.
    environment: 'node',
    include: ['src/core/**/*.test.ts'],
    // Explicit imports in test files rather than injected globals, so the test
    // files obey the same import rules as everything else in core/.
    globals: false,
  },
})
