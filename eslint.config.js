import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Architecture boundary: the pure simulation core (src/sim) and shared contracts
 * (src/shared) must stay free of Three.js, DOM, browser storage, worker APIs,
 * and nondeterministic time/random sources. `npm run validate` re-checks the
 * same boundary with an independent import scan.
 */
const simPurityRules = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'three', message: 'Three.js is presentation-only; the sim core must stay pure.' },
        { name: 'vite', message: 'The sim core must not depend on Vite.' },
      ],
      patterns: [
        {
          group: ['**/render/**', '**/ui/**', '**/app/**', '**/worker/**'],
          message: 'The sim core must not import presentation, UI, app, or worker modules.',
        },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'document', message: 'No DOM access in the sim core.' },
    { name: 'window', message: 'No DOM access in the sim core.' },
    { name: 'navigator', message: 'No browser APIs in the sim core.' },
    { name: 'localStorage', message: 'No browser storage in the sim core.' },
    { name: 'sessionStorage', message: 'No browser storage in the sim core.' },
    { name: 'requestAnimationFrame', message: 'No frame timing in the sim core.' },
    { name: 'setTimeout', message: 'No wall-clock timers in the sim core.' },
    { name: 'setInterval', message: 'No wall-clock timers in the sim core.' },
    { name: 'performance', message: 'No wall-clock timing in the sim core.' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use the seeded RNG owned by the sim core.' },
    { object: 'Date', property: 'now', message: 'Canonical time is the logical tick count.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: 'Wall-clock dates may not influence canonical state.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'artifacts/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/sim/**/*.ts', 'src/shared/**/*.ts'],
    rules: simPurityRules,
  },
  prettier,
);
