import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      output: {
        // three.js is the bulk of the bundle and never changes between builds,
        // so split it out to keep the app chunk small and cacheable.
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
