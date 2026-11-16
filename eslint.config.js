'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'public/js/clerk-es.js', 'public/vendor/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
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
    // Fuente del campus 3D: modulos ES que esbuild empaqueta en public/vendor/.
    files: ['interfaz/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.browser },
    rules: { 'no-unused-vars': 'error', eqeqeq: ['error', 'always'], 'prefer-const': 'error', 'no-var': 'error' }
  },
  {
    // Interfaz heredada: tres scripts clasicos que comparten ambito global.
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
