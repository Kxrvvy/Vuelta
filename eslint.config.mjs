import tseslint from 'typescript-eslint'

/**
 * Layer boundaries, enforced by a linter rather than by memory.
 *
 * CLAUDE.md calls these boundaries absolute:
 *
 *   skins/ -> receives only RenderState + Actions. No fetch. No tokens.
 *   core/  -> pure logic. No React. No DOM.
 *   main/  -> auth, token storage, all HTTP. The only layer that knows Spotify exists.
 *
 * The compiler already enforces half of this: tsconfig.core.json gives core/
 * neither the DOM lib nor Node types, so `document` and `process` do not exist
 * there. What the compiler cannot catch is a legal-but-forbidden *import* —
 * core/ pulling in React, or a skin reaching for the API client. That is what
 * the no-restricted-imports zones below are for.
 *
 * To confirm these are live: add `import React from 'react'` to any file in
 * src/core/ and run `npm run lint`. It must fail.
 */

const CORE_MESSAGE =
  'core/ is pure logic: no React, no DOM, no Electron, no Node built-ins. It must run in a plain Vitest file.'

const SKIN_MESSAGE =
  'skins/ receive only RenderState and Actions. No fetch, no tokens, no awareness that Spotify exists.'

const RENDERER_MESSAGE =
  'The renderer reaches the main process only through the preload bridge (window.vuelta).'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', '.tsbuild/**', 'node_modules/**'],
  },

  ...tseslint.configs.recommended,

  {
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-restricted-globals': ['error', 'event', 'name', 'length'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // Printing a report is the entire job of the environment check.
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  // ---- core/: pure logic ---------------------------------------------------
  {
    files: ['src/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: CORE_MESSAGE },
            { name: 'react-dom', message: CORE_MESSAGE },
            { name: 'react-dom/client', message: CORE_MESSAGE },
            { name: 'electron', message: CORE_MESSAGE },
          ],
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'http', 'crypto'],
              message: CORE_MESSAGE,
            },
            {
              group: ['**/main/**', '**/app/**', '**/skins/**', '**/views/**'],
              message: CORE_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // ---- skins/: drawing only ------------------------------------------------
  {
    files: ['src/skins/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: SKIN_MESSAGE }],
          patterns: [
            { group: ['node:*'], message: SKIN_MESSAGE },
            { group: ['**/main/**'], message: SKIN_MESSAGE },
          ],
        },
      ],
    },
  },

  // ---- app/ and views/: renderer, bridge only ------------------------------
  {
    // global.d.ts is exempt: declaring the shape of window.vuelta is precisely
    // its job, and the type it needs lives in core/, not main/.
    files: ['src/app/**/*.{ts,tsx}', 'src/views/**/*.{ts,tsx}'],
    ignores: ['src/app/global.d.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: RENDERER_MESSAGE }],
          patterns: [
            { group: ['node:*'], message: RENDERER_MESSAGE },
            { group: ['**/main/**'], message: RENDERER_MESSAGE },
          ],
        },
      ],
    },
  },
)
