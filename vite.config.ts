import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: 'src/ui/index.tsx',
        background: 'src/background/index.ts',
        contentScript: 'src/contentScript/index.ts',
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
