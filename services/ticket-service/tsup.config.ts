import { defineConfig } from 'tsup';

// Bundle the service + its @billfree/* workspace packages into a single ESM
// file. Real npm deps (fastify, pg, …) stay external and are installed in the
// runtime image — this keeps the build hermetic and the container small.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  minify: false,
  noExternal: [/^@billfree\//],
});
