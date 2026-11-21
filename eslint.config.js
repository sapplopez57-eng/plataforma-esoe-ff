'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'salida-vercel/**', 'public/js/clerk-es.js', 'public/vendor/**'] },
  js.configs.recommended,
  { rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
  {
    files: ['src/**/*.js', 'api/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  },
  {
    files: ['tests/navegador.test.js'],
    languageOptions: {
      globals: { window: 'readonly', navigateTo: 'readonly', openModalNuevoPeriodo: 'readonly', store: 'readonly' }
    }
  },
  {
    files: ['interfaz/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.browser },
    rules: { 'no-unused-vars': 'error', eqeqeq: ['error', 'always'], 'prefer-const': 'error', 'no-var': 'error' }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: globals.browser },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  }
];
