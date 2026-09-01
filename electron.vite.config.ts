import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

/**
 * Three builds from one config: main, preload, renderer.
 *
 * The renderer root is `src` rather than a separate `src/renderer` directory so
 * the folder layout stays exactly as spec §15 describes it.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/preload.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
  },
})
