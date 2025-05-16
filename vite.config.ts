import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

// Load environment variables
const env = dotenv.config();
dotenvExpand.expand(env);

// Get the client ID from environment variables
const CLIENT_ID = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID || 'YOUR_GOOGLE_OAUTH_CLIENT_ID';

// Function to copy files recursively with content replacement
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
      // Special handling for manifest.json to replace CLIENT_ID
      if (file === 'manifest.json') {
        let content = fs.readFileSync(srcPath, 'utf8');
        content = content.replace('${CLIENT_ID}', CLIENT_ID);
        fs.writeFileSync(destPath, content);
      } else {
        // Copy file normally
        fs.copyFileSync(srcPath, destPath);
      }
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
  define: {
    // Make environment variables available to the client code
    'import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID':
      JSON.stringify(process.env.VITE_GOOGLE_OAUTH_CLIENT_ID || ''),
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
