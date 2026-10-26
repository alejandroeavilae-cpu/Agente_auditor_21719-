// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuración de ESLint para todo el monorepo (formato "flat config").
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.config.ts', '**/vite.config.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Prohibido: las conversiones implícitas a texto pueden filtrar objetos con datos.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // NestJS usa clases solo con decoradores (módulos), que son válidas.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      'no-console': 'off',
    },
  },
  {
    // En pruebas se permiten aserciones no nulas sobre datos sintéticos construidos en la propia prueba.
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
