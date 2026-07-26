import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The application consumes several untyped legacy API payloads. Keep their
      // migration visible without blocking the build until each API is typed.
      "@typescript-eslint/no-explicit-any": "warn",
      // React Compiler is not enabled for this project, so its compiler-only
      // diagnostics should not be enforced by the standard Hooks preset.
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": "off",
    },
  },
])
