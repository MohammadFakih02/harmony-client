// @ts-check
// Flat ESLint config for the Angular 21 client. Scope: code-quality/correctness rules only —
// formatting is intentionally NOT enforced here (the repo is not run through a formatter gate;
// see the T1 audit decision). angular-eslint is pinned to the v21 line to match the CLI.
//
// Enforcement philosophy for a lint gate introduced onto an existing codebase: block on genuine
// correctness, and surface (not block) the opinionated/broad rules so they can be tightened over
// time without a risky mass-refactor. Rules set to 'warn' below are deliberate — each notes why.
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    // Not source — build output, deps, caches, tauri shell, and generated files.
    ignores: ['dist/**', 'node_modules/**', '.angular/**', 'coverage/**', 'src-tauri/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Honor `_`-prefixed intentional-unused names and the destructure-to-omit pattern
      // (`const { drop, ...rest } = x`), both used deliberately across the codebase.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Harmless intent-signalling escapes inside regex character classes (e.g. `\-`, `\[`);
      // flagging them fights readability of behavior-sensitive patterns. Surface, don't block.
      'no-useless-escape': 'warn',
      // The shared UI library deliberately uses `ui-*`/`harmony-*` element selectors alongside
      // feature `app-*` ones — allow all three prefixes rather than rename every selector.
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ['app', 'ui', 'harmony'], style: 'kebab-case' },
      ],
      // Two intentional unprefixed attribute directives (auto-grow, autofocus). Surface, don't block.
      '@angular-eslint/directive-selector': 'warn',
      // Modernization (constructor DI -> inject()); valuable but a broad mechanical change — surface
      // it so new code trends the right way without forcing a risky sweep now.
      '@angular-eslint/prefer-inject': 'warn',
      // Outputs shadowing native event names: renaming is a public-API/behavior change per component;
      // surface for case-by-case cleanup rather than block.
      '@angular-eslint/no-output-native': 'warn',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      // Require strict equality in templates, but keep the intentional `!= null` / `== null`
      // idiom that guards null AND undefined in one check (converting to `!==` would be a bug).
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
      // Accessibility rules overlap the §5.55 Lighthouse pass's already-accepted design decisions;
      // keep them visible as warnings (radar for new templates) instead of blocking the build.
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'warn',
      '@angular-eslint/template/label-has-associated-control': 'warn',
      '@angular-eslint/template/no-autofocus': 'warn',
    },
  },
  {
    // Test files legitimately use `any` for mock/stub shapes; don't block on it there.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
