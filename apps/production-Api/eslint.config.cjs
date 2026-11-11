// API lint: errors for real bugs, silence for style. Warnings stay advisory;
// CI gates on errors only. Type-aware rules are deliberately off — tsc with
// strict null checks already covers that ground and runs in the same job.
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = [
  {ignores: ['dist/**', 'node_modules/**', 'coverage/**']},
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', {allowEmptyCatch: false}],
      'no-constant-condition': 'error',
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
