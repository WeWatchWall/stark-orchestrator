module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',

  plugins: [
    '@typescript-eslint',
  ],

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],

  env: {
    node: true
  },

  'extends': [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/essential',
    '@vue/standard'
  ],

  parserOptions: {
    ecmaVersion: 2020
  },

  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off'
  }
};
