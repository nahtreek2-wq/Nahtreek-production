module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Intentionally-unused convention (e.g. omitting a field to simulate an
    // old backend in tests). Errors still fire for anything else.
    '@typescript-eslint/no-unused-vars': ['error', {varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
  },
};
