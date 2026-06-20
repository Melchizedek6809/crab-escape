// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths: works on GH Pages project subpaths, custom domains
  // and the itch.io zip without per-deploy reconfiguration.
  base: './',
  build: {
    chunkSizeWarningLimit: 2048,
    modulePreload: {
      polyfill: false,
    },
    target: "esnext",
    sourcemap: true,
  },
  publicDir: 'assets'
})