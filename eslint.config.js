import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import i18next from 'eslint-plugin-i18next';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Downgrade every ENABLED rule in a preset's rule-map to 'warn' (preserving each
// rule's options, leaving 'off' rules off). Lets us adopt a whole `recommended`
// set for VISIBILITY — the React Compiler bailout diagnostics and jsx-a11y —
// without turning their many `error`-level rules into gate-breaking CI failures
// on the 120+ pre-existing components. `npm run lint` has no --max-warnings, so
// warnings surface in output but never fail the gate. Promote per-rule to error
// once a rule's violations are driven to zero (see exhaustive-deps below).
const toWarn = (rules) =>
  Object.fromEntries(
    Object.entries(rules ?? {}).map(([id, val]) => {
      const sev = Array.isArray(val) ? val[0] : val;
      if (sev === 'off' || sev === 0) return [id, val];
      return [id, Array.isArray(val) ? ['warn', ...val.slice(1)] : 'warn'];
    })
  );

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
  // Lock-in: forbid hand-written request interfaces (`*Body|*Params|*Query|*Filters`)
  // in routes/. Every request shape — body, params, AND query — must be authored once
  // as Zod in shared/contracts/*.contract.ts and the handler typed from its `z.infer`
  // (the shared-contract convention — see CLAUDE.md). This keeps the request shape the
  // single source of truth shared with the client. (Extended from `*Body` to all four
  // suffixes once Phase 4 drove the params/query fold to D1 = 0.)
  {
    files: ['routes/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSInterfaceDeclaration[id.name=/(Body|Params|Query|Filters?)$/]',
          message:
            'Hand-written request interfaces (`*Body|*Params|*Query|*Filters`) are forbidden in routes/. Author the request shape as Zod in shared/contracts/*.contract.ts and type the handler from its `z.infer`. (A non-request shape that happens to end in one of these words should be renamed.)'
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
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y
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
      // React Hooks + React Compiler diagnostics. eslint-plugin-react-hooks v7's
      // `recommended-latest` ships the compiler-bailout rules (immutability /
      // purity / set-state-in-effect / static-components / preserve-manual-
      // memoization / …) — we rely on the Compiler for memoization but nothing
      // warned when a component is written in a way it bails on. Surface them as
      // WARN (the standalone, now-deprecated eslint-plugin-react-compiler is
      // unnecessary — these ARE its rules). rules-of-hooks + exhaustive-deps are
      // re-elevated to ERROR below: the repo lints clean (0 exhaustive-deps
      // warnings today), so ratcheting it to error stops future dep-array drift.
      ...toWarn(reactHooks.configs.flat['recommended-latest'].rules),
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // Accessibility — there was zero a11y linting across 120+ components.
      // WARN-only (same gate-safety reason); promote per-rule as screens are
      // cleaned up.
      ...toWarn(jsxA11y.flatConfigs.recommended.rules),
      // Funnel migration (audit H1): all HTTP must go through core/http.ts so
      // credentials, error-throwing, and success-envelope unwrapping are uniform.
      // ERROR: the H1 funnel is complete (all ~310 sites migrated), so a new bare
      // fetch() now fails CI. The few legitimate raw uses (blob/stream downloads,
      // the Zod portal boundary, sendBeacon) take an inline
      // // eslint-disable-next-line no-restricted-syntax with a reason.
      // require-schema-on-reads (shared-contract lock-in — D3): every read via
      // fetchJSON/apiLoader must carry a Zod `{ schema: <contract>.response }`. That
      // client schema is the ONLY fail-loud response guard in prod (the server
      // sendData parse is dev-only), so an unguarded read silently accepts drift.
      // The esquery `:not(:has(Property[key.name='schema']))` matches a fetchJSON/
      // apiLoader CallExpression with no `schema:` property anywhere in its arguments.
      // The few legitimately schema-less reads (literal-null signals, raw passthroughs,
      // status pings, fire-and-forget) take an inline
      // // eslint-disable-next-line no-restricted-syntax with a reason — same escape
      // hatch as the bare-fetch() ban below.
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
        },
        {
          selector:
            "CallExpression[callee.name=/^(fetchJSON|apiLoader)$/]:not(:has(Property[key.name='schema']))",
          message:
            'Reads via fetchJSON/apiLoader must pass a Zod guard `{ schema: <contract>.response }` — it is the only fail-loud response validation in prod (the server sendData parse is dev-only). For a deliberately schema-less read (literal-null signal, raw passthrough, status ping, fire-and-forget) add an inline // eslint-disable-next-line no-restricted-syntax with a reason. (Shared-contract lock-in — D3.)'
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
  // Unit tests stub the network and exercise the funnel itself, so the
  // bare-fetch and schema-on-reads ratchets don't apply inside *.test.ts.
  {
    files: ['public/**/*.test.ts', 'public/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  // i18n ratchet (lock-in): translated surfaces forbid hardcoded user-facing
  // strings. The `files` list IS the ratchet — every later i18n plan APPENDS its
  // newly-translated files here, so a raw string sneaking back in fails CI.
  // `mode: 'jsx-only'` checks JSX text + the user-facing DOM attributes
  // (placeholder/alt/aria-label/value/title — the plugin's built-in blacklistAttrs;
  // className/id/aria-hidden/role on DOM tags are auto-allowed). The `words.exclude`
  // re-states the plugin's default punctuation/ALL-CAPS excludes, because the options
  // merge is a shallow `_.defaults` (a provided `words` REPLACES the default wholesale
  // rather than extending it). The clinic name is now dynamic branding data
  // (Settings → General), not a hardcoded literal, so no brand string is excluded.
  // These files inherit the tsparser languageOptions from the frontend block above
  // (their globs are a subset of it).
  {
    files: [
      'public/js/routes/Dashboard.tsx',
      'public/js/components/react/UniversalHeader.tsx',
      'public/js/routes/Expenses.tsx',
      'public/js/components/expenses/ExpenseFilters.tsx',
      'public/js/components/expenses/ExpenseTable.tsx',
      'public/js/components/expenses/ExpenseSummary.tsx',
      'public/js/components/expenses/ExpenseModal.tsx',
      'public/js/components/expenses/DeleteConfirmModal.tsx',
      'public/js/components/react/appointments/DailyAppointments.tsx',
      'public/js/components/react/appointments/AppointmentsHeader.tsx',
      'public/js/components/react/appointments/AppointmentsList.tsx',
      'public/js/components/react/appointments/AppointmentCard.tsx',
      'public/js/components/react/appointments/StatsCards.tsx',
      'public/js/components/react/appointments/ConnectionStatus.tsx',
      'public/js/components/react/appointments/DoctorFilterSelect.tsx',
      'public/js/components/react/appointments/MobileViewToggle.tsx',
      'public/js/components/react/WorkComponent.tsx',
      'public/js/components/react/WorkCard.tsx',
      'public/js/components/react/AppointmentForm.tsx',
      'public/js/components/react/EditAppointmentForm.tsx',
      'public/js/components/react/SimplifiedCalendarPicker.tsx',
      'public/js/components/react/PatientAppointments.tsx',
      'public/js/components/react/PaymentModal.tsx',
      'public/js/components/react/Navigation.tsx',
      'public/js/components/react/AddPatientForm.tsx',
      'public/js/components/react/EditPatientComponent.tsx',
      'public/js/components/react/ViewPatientInfo.tsx',
      'public/js/components/react/PortalActivityBell.tsx'
    ],
    plugins: {
      i18next
    },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          // Structural/identity attributes on the shared <Modal>/<ModalHeader>
          // components are never user-facing, so a string literal there is fine:
          // titleId/ariaLabelledBy are id references (cf. the allowed id/htmlFor)
          // and variant is a design-system enum (default|danger|warning|…). `to`
          // is a React Router <Link>/<Navigate> route path (a location, never
          // display text — the sibling of the allowed id/htmlFor). This extends
          // the plugin's DEFAULT jsx-attributes exclude (which `_.defaults` would
          // otherwise drop wholesale once this key is set) so the real user-facing
          // attrs — title/label/placeholder/alt/aria-label — stay checked.
          'jsx-attributes': {
            exclude: [
              'className', 'styleName', 'style', 'type', 'key', 'id', 'width', 'height',
              'titleId', 'ariaLabelledBy', 'variant', 'to'
            ]
          },
          words: { exclude: ['[0-9!-/:-@[-`{-~]+', '[A-Z_-]+'] }
        }
      ]
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
