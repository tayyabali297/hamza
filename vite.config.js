import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    // transformers.js uses dynamic WASM imports — exclude from Vite pre-bundling
    exclude: ['@xenova/transformers'],
  },
});
