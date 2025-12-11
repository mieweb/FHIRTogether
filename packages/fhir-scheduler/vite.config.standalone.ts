import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/web-component.ts'),
      name: 'FhirSchedulerStandalone',
      formats: ['es'],
      fileName: () => 'standalone.js',
    },
    rollupOptions: {
      // Bundle everything for standalone use
      external: [],
    },
    sourcemap: true,
    minify: true,
    outDir: 'dist',
    emptyOutDir: false,
  },
});
