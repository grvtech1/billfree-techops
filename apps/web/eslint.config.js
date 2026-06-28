// ESLint 9 flat config for the React SPA.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  // e2e/** + playwright.config.ts are a local visual-regression tool (not app
  // source, not shipped); they use Playwright's own TS setup, so skip app lint.
  { ignores: ['dist/**', 'node_modules/**', '_archive/**', 'coverage/**', 'e2e/**', 'playwright.config.ts'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2021, sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        BroadcastChannel: 'readonly',
        MessageEvent: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-undef': 'off', // TS handles this; avoids false positives on DOM/global types
      // ── Module-boundary enforcement (frontend modularization) ──
      // The shell composes packages via their PUBLIC entry (@billfree/<pkg>).
      // Reaching into a package's src/ internals defeats the boundary, so ban it.
      // See docs/FRONTEND_MODULARIZATION.md for the full layer contract.
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@billfree/*/src', '@billfree/*/src/*'],
            message: 'Import a package via its public entry (@billfree/<pkg>), not its src/ internals.',
          },
        ],
      }],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    languageOptions: {
      globals: { describe: 'readonly', it: 'readonly', expect: 'readonly', vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' },
    },
  },
];
