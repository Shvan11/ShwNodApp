import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-ts/**',
      'dist-server/**',
      '*.min.js',
      'public/libs/**',
      'public/photoswipe/**',
      'aligner-portal-external/**',
      '**/assets/**/*.js',
      'scripts/**'
    ]
  },
  // Backend TypeScript files
  {
    files: ['**/*.ts'],
    ignores: ['public/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-unused-vars': 'off',
      // TypeScript handles identifier resolution (including type-only references
      // like NodeJS, Express, PDFKit namespaces) better than ESLint's no-undef.
      // See: https://typescript-eslint.io/troubleshooting/faqs/general/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined
      'no-undef': 'off'
    }
  },
  // Lock-in: forbid hand-written `interface *Body` in routes/. Every request body
  // must be authored once as a strict Zod `z.object` in shared/contracts/*.contract.ts
  // and the handler typed from its `z.infer` (the shared-contract convention — see
  // CLAUDE.md). This keeps the body the single source of truth shared with the client.
  {
    files: ['routes/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSInterfaceDeclaration[id.name=/Body$/]',
          message:
            'Hand-written `interface *Body` is forbidden in routes/. Author the request body as a strict Zod `z.object` in shared/contracts/*.contract.ts and type the handler from its `z.infer`.'
        }
      ]
    }
  },
  // Frontend TypeScript/TSX files
  {
    files: ['public/**/*.ts', 'public/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.es2022
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react': react,
      'react-hooks': reactHooks
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Funnel migration (audit H1): all HTTP must go through core/http.ts so
      // credentials, error-throwing, and success-envelope unwrapping are uniform.
      // ERROR: the H1 funnel is complete (all ~310 sites migrated), so a new bare
      // fetch() now fails CI. The few legitimate raw uses (blob/stream downloads,
      // the Zod portal boundary, sendBeacon) take an inline
      // // eslint-disable-next-line no-restricted-syntax with a reason.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Use the helpers in core/http.ts (fetchJSON/postJSON/putJSON/deleteJSON/postFormData) instead of bare fetch() — they add credentials, throw on !ok, and unwrap the success envelope. (Audit H1 funnel.)'
        },
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name='fetch']",
          message: 'Use the helpers in core/http.ts instead of window.fetch(). (Audit H1 funnel.)'
        }
      ]
    }
  },
  // core/http.ts is the one place that legitimately calls fetch() — it IS the wrapper.
  {
    files: ['public/js/core/http.ts'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  // JavaScript config/utility files
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        WebSocket: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  prettier
];
