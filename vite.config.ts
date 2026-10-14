import { defineConfig } from 'vite';
import path from 'path';
import { execSync } from 'child_process';

// Shown on Home so you can tell which build a device is running.
function buildId(): string {
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  return `${new Date().toISOString().slice(0, 10)} · ${sha}`;
}

export default defineConfig({
  base: '/english-games/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2015',
    sourcemap: false,
  },
});
