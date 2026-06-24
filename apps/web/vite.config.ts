import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      // Exposed at build time so the bundle knows the GAS endpoint.
      // Also available via import.meta.env.VITE_GAS_URL at runtime.
      __GAS_URL__: JSON.stringify(env.VITE_GAS_URL || env.GAS_URL || ''),
    },
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
    build: {
      outDir: 'dist',
      sourcemap: true,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor:  ['react', 'react-dom'],
            charts:  ['recharts'],
            zustand: ['zustand'],
          },
        },
      },
    },
    server: {
      port: 5173,
      open: true,
    },
  };
});
