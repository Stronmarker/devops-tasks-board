import globals from 'globals';

// Configuration "flat" (ESLint 9). Le backend tourne sous Node en ESM :
// on declare les globales Node et on interdit les erreurs qui passeraient
// silencieusement en production (variable non definie, promesse ignoree).
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
