import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.mocha
      }
    },
    rules: {
      semi: ['error', 'always'],
      'no-unused-vars': ['error', { vars: 'all', args: 'after-used', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      quotes: ['error', 'single'],
      indent: ['error', 2]
    }
  },
  {
    files: ['docs/js/**/*.js'],
    languageOptions: {
      globals: globals.browser
    }
  }
];
