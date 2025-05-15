import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import * as fs from 'fs';

// Function to copy files recursively
function copyPublicFolder(src: string, dest: string) {
  const files = fs.readdirSync(src);

  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);

    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      // Create directory if it doesn't exist
      try {
        fs.readdirSync(destPath);
      } catch (e) {
        // Directory doesn't exist, create it
        fs.mkdirSync(destPath, { recursive: true });
      }

      // Copy contents recursively
      copyPublicFolder(srcPath, destPath);
    } else {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-public-folder',
      closeBundle() {
        // Copy public folder to dist
        copyPublicFolder('public', 'dist');
      },
    },
  ],
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
