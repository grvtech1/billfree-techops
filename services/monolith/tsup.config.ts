import { defineConfig } from 'tsup';

// Bundle the monolith + all @billfree/* workspace packages (the service libs it
// composes) into a single ESM file. The createRequire banner lets bundled
// CommonJS deps (e.g. pg) call require() at runtime under ESM output.
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
