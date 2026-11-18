import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'dist-harness/', 'vendor/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Security rules (PLAN.md §10): no dynamic code execution.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // The draw.io frame script runs before and next to the vendored viewer, which defines these globals.
    files: ['src/drawio-frame/frame.js'],
    languageOptions: { globals: { mxUtils: 'readonly', GraphViewer: 'readonly' } },
  },
);
