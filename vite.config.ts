import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5178 },
  // manifold-3d ships a hand-written .js loader beside its .wasm; leaving it
  // unoptimised keeps Vite from rewriting the paths it uses to find the binary.
  optimizeDeps: { exclude: ['manifold-3d'] },
})
