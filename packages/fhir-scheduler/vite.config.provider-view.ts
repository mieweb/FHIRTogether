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
      entry: resolve(__dirname, 'src/provider-view.tsx'),
      name: 'FhirProviderView',
      formats: ['es'],
      fileName: () => 'provider-view.js',
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
