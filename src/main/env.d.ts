/**
 * Types for the build-time environment variables electron-vite inlines into
 * the main process bundle.
 *
 * Only non-secret values may appear here — every one of these is compiled
 * into the shipped binary as a literal. See .env.example.
 */
interface ImportMetaEnv {
  /** Dev-only. Forced off in packaged builds regardless of value. */
  readonly MAIN_VITE_OPEN_DEVTOOLS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
