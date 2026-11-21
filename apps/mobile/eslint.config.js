// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'node_modules/**', '.expo/**', 'public/maplibre/**'] },
  {
    rules: {
      // design-system.md: colours come from tokens only
      'no-restricted-syntax': ['error', { selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]", message: 'Use design tokens (src/theme/tokens.ts).' }],
    },
  },
  { files: ['src/theme/tokens.ts'], rules: { 'no-restricted-syntax': 'off' } },
]);
