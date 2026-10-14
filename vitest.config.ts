import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// unit tests only; e2e/ is run by Playwright
export default mergeConfig(viteConfig, defineConfig({ test: { include: ['src/**/*.test.ts'] } }));
