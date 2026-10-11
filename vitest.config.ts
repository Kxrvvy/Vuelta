import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // No jsdom, deliberately. Spec §5's test for whether the layer boundary is
    // real is that core/ runs with no DOM. If a test here ever needs a DOM,
    // something has leaked out of the skin layer and into core.
    environment: 'node',
    // Widened beyond core/ so the skin can test its pure maths (camera
    // framing, arm geometry). The environment stays node, so this does not
    // weaken the rule that core must run without a DOM.
    include: ['src/**/*.test.ts'],
    // Explicit imports in test files rather than injected globals, so the test
    // files obey the same import rules as everything else in core/.
    globals: false,
  },
})
