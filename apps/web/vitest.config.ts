import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@billfree/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@billfree/web-core': path.resolve(__dirname, '../../packages/web-core/src'),
      '@billfree/api': path.resolve(__dirname, '../../packages/api/src'),
      '@billfree/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@billfree/app-state': path.resolve(__dirname, '../../packages/app-state/src'),
      '@billfree/feature-tickets': path.resolve(__dirname, '../../packages/feature-tickets/src'),
      '@billfree/feature-calllog': path.resolve(__dirname, '../../packages/feature-calllog/src'),
      '@billfree/feature-reports': path.resolve(__dirname, '../../packages/feature-reports/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/store/**', 'src/hooks/**'],
    },
  },
  define: {
    __GAS_URL__: JSON.stringify(''),
  },
});
