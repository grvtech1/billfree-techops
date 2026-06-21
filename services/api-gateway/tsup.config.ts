import { defineConfig } from 'tsup';

// Bundle the service + its @billfree/* workspace packages into a single ESM file.
// The createRequire banner lets any bundled CommonJS dependency (e.g. pg) call
// require() at runtime — without it, esbuild's ESM output throws
// "Dynamic require of X is not supported" the moment the service starts.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  minify: false,
  noExternal: [/^@billfree\//],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
