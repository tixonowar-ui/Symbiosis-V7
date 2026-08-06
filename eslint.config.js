import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'reports/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // Pipeline output: linting it would report on tools/import, not on code
      // anyone is allowed to edit here. See CLAUDE.md.
      'generated/**',
    ],
  },

  js.configs.recommended,

  // Every .ts/.tsx file belongs to one of the two tsconfig projects, so
  // type-aware rules apply everywhere — including the root *.config.ts files,
  // which tsconfig.json includes on purpose.
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript resolves identifiers itself; no-undef only produces false
      // positives on type-only names.
      'no-undef': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Node side: host, domain, persistence, shared, tooling, tests, root configs.
  {
    files: [
      'src/shared/**/*.ts',
      'src/domain/**/*.ts',
      'src/persistence/**/*.ts',
      'src/host/**/*.ts',
      'tools/**/*.ts',
      'tests/**/*.ts',
      '*.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },

  // Renderer runs in the browser.
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },

  // This file is plain ESM JavaScript and is not part of a tsconfig project.
  {
    files: ['eslint.config.js'],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
