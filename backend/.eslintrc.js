// ESLint 8 (legacy config) for the NestJS backend. Based on the config the
// Nest CLI generates, without the type-aware parser (tsconfig.json excludes
// test/, so type-aware rules could not lint the specs) and without
// prettier/prettier: the repository has no Prettier config and formatting is
// not gated. eslint-config-prettier only switches off stylistic rules.
//
// `npm run lint` checks everything and reports the existing debt (see
// docs/DEVELOPER_GUIDE.md, "Linting"); CI gates only the files changed against
// main (`npm run lint:changed`).
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist/', 'node_modules/', 'coverage/', 'coverage-e2e/'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
