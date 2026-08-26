import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Configuration "flat" (ESLint 9). Le frontend tourne dans le navigateur :
// globales DOM + regles des hooks React, qui detectent les erreurs classiques
// (hook appele conditionnellement, dependance manquante dans un useEffect).
export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Sans cette regle, un composant utilise uniquement en JSX (<App />) est
      // vu comme un import mort par no-unused-vars.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Charger les donnees au montage via useEffect est le comportement voulu
      // ici. La regle vise les setState synchrones ; loadTasks est asynchrone,
      // et introduire une librairie de data-fetching depasse le cadre du TP.
      'react-hooks/set-state-in-effect': 'off',
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
